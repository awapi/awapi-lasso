import React, { useState } from 'react';
import { Copy, KeyRound, Layers, Plus, Trash2, X } from 'lucide-react';
import {
  createDefaultEnvironment,
  generateAwjcId,
  type AuthProfile,
  type AwjcCollection,
  type EnvironmentConfig,
  type VariableEntry,
} from '../../../shared/collectionSchema';
import { KeyValueTable } from './KeyValueTable';
import { RequestAuthTab } from './RequestAuthTab';
import { useTheme } from '../context/ThemeContext';
import {
  useDraggableResizableModal,
  type ModalResizeDirection,
} from '../hooks/useDraggableResizableModal';

const MIN_MODAL_WIDTH = 640;
const MIN_MODAL_HEIGHT = 420;

const RESIZE_HANDLES: Array<{ dir: ModalResizeDirection; style: React.CSSProperties }> = [
  { dir: 'n', style: { top: 0, left: 10, right: 10, height: 6, cursor: 'ns-resize' } },
  { dir: 's', style: { bottom: 0, left: 10, right: 10, height: 6, cursor: 'ns-resize' } },
  { dir: 'w', style: { left: 0, top: 10, bottom: 10, width: 6, cursor: 'ew-resize' } },
  { dir: 'e', style: { right: 0, top: 10, bottom: 10, width: 6, cursor: 'ew-resize' } },
  { dir: 'nw', style: { top: 0, left: 0, width: 12, height: 12, cursor: 'nwse-resize' } },
  { dir: 'ne', style: { top: 0, right: 0, width: 12, height: 12, cursor: 'nesw-resize' } },
  { dir: 'sw', style: { bottom: 0, left: 0, width: 12, height: 12, cursor: 'nesw-resize' } },
  { dir: 'se', style: { bottom: 0, right: 0, width: 16, height: 16, cursor: 'nwse-resize' } },
];

const ENV_COLOR_PALETTE = [
  '#22c55e', // green (local)
  '#3b82f6', // blue (dev)
  '#f59e0b', // amber (staging)
  '#ef4444', // red (prod)
  '#a855f7', // purple
  '#06b6d4', // cyan
];

export type EnvironmentModalTab = 'environments' | 'collectionVariables' | 'authProfiles';

export interface EnvironmentManagerModalProps {
  isOpen: boolean;
  initialTab?: EnvironmentModalTab;
  collection: AwjcCollection;
  /** Called with the edited draft when the user clicks Save (or presses Cmd/Ctrl+S). */
  onSave: (collection: AwjcCollection) => void | Promise<unknown>;
  onClose: () => void;
}

interface PendingSecretOp {
  scopeId: string;
  key: string;
  value: string;
  isSecret: boolean;
}

export const EnvironmentManagerModal: React.FC<EnvironmentManagerModalProps> = props => {
  if (!props.isOpen) return null;
  // Mounting a fresh dialog on every open resets the draft to the latest collection state.
  return <EnvironmentManagerDialog {...props} />;
};

const EnvironmentManagerDialog: React.FC<EnvironmentManagerModalProps> = ({
  initialTab = 'environments',
  collection: sourceCollection,
  onSave,
  onClose,
}) => {
  const { colors } = useTheme();
  const { rect, isInteracting, handleHeaderMouseDown, handleResizeMouseDown } =
    useDraggableResizableModal({
      initialWidth: 940,
      initialHeight: Math.round((window.innerHeight || 800) * 0.8),
      minWidth: MIN_MODAL_WIDTH,
      minHeight: MIN_MODAL_HEIGHT,
    });
  const [activeTab, setActiveTab] = useState<EnvironmentModalTab>(initialTab);
  const [collection, setDraft] = useState<AwjcCollection>(sourceCollection);
  const [hasEdits, setHasEdits] = useState(false);
  const [pendingSecretOps, setPendingSecretOps] = useState<PendingSecretOp[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const onUpdateCollection = (next: AwjcCollection) => {
    setDraft(next);
    setHasEdits(true);
    setConfirmDiscard(false);
  };

  const environments = collection.environments ?? [];
  const [selectedEnvId, setSelectedEnvId] = useState<string>(
    environments.find(e => e.name === collection.activeEnvironment)?.id ??
      environments[0]?.id ??
      '',
  );
  const authProfiles = collection.authProfiles ?? [];
  const [selectedProfileId, setSelectedProfileId] = useState<string>(
    authProfiles[0]?.id ?? '',
  );

  const selectedEnv =
    environments.find(e => e.id === selectedEnvId) ?? environments[0] ?? null;

  const selectedProfile =
    authProfiles.find(p => p.id === selectedProfileId) ?? authProfiles[0] ?? null;

  const persistSecretToggle = (
    scopeId: string,
    entry: VariableEntry,
    isSecret: boolean,
  ) => {
    if (!entry.key.trim()) return;
    setPendingSecretOps(prev => [
      ...prev,
      { scopeId, key: entry.key, value: entry.value ?? '', isSecret },
    ]);
    setHasEdits(true);
  };

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      for (const op of pendingSecretOps) {
        const coord = { collectionId: collection.metadata.id, scopeId: op.scopeId, key: op.key };
        if (op.isSecret) {
          await window.electronAPI?.setSecret?.(coord, op.value);
        } else {
          await window.electronAPI?.deleteSecret?.(coord);
        }
      }
      await onSave(collection);
    } catch (err) {
      setIsSaving(false);
      setSaveError(err instanceof Error ? err.message : String(err));
      return;
    }
    onClose();
  };

  const handleRequestClose = () => {
    if (hasEdits) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };

  const handleDialogKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const isMod = e.metaKey || e.ctrlKey;
    if (isMod && e.key.toLowerCase() === 's') {
      // Keep the app-level Cmd/Ctrl+S handler from saving the stale collection.
      e.preventDefault();
      e.stopPropagation();
      void handleSave();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      handleRequestClose();
    }
  };

  /* --- Environment Operations --- */
  const handleAddEnvironment = () => {
    const idx = environments.length + 1;
    const newEnv = createDefaultEnvironment(
      `env-${idx}`,
      ENV_COLOR_PALETTE[environments.length % ENV_COLOR_PALETTE.length],
      [{ key: 'baseUrl', value: 'http://localhost:8080', enabled: true }],
    );
    const nextEnvs = [...environments, newEnv];
    onUpdateCollection({
      ...collection,
      environments: nextEnvs,
      activeEnvironment: collection.activeEnvironment ?? newEnv.name,
    });
    setSelectedEnvId(newEnv.id);
  };

  const handleDuplicateEnvironment = (env: EnvironmentConfig) => {
    const dup: EnvironmentConfig = {
      id: generateAwjcId('env'),
      name: `${env.name}-copy`,
      color: env.color,
      variables: env.variables.map(v => ({ ...v })),
    };
    onUpdateCollection({
      ...collection,
      environments: [...environments, dup],
    });
    setSelectedEnvId(dup.id);
  };

  const handleDeleteEnvironment = (envId: string) => {
    const remaining = environments.filter(e => e.id !== envId);
    const nextActive =
      remaining.find(e => e.name === collection.activeEnvironment)?.name ??
      remaining[0]?.name;
    onUpdateCollection({
      ...collection,
      environments: remaining,
      activeEnvironment: nextActive,
    });
    if (selectedEnvId === envId) {
      setSelectedEnvId(remaining[0]?.id ?? '');
    }
  };

  const handleUpdateSelectedEnv = (patch: Partial<EnvironmentConfig>) => {
    if (!selectedEnv) return;
    const nextEnvs = environments.map(e =>
      e.id === selectedEnv.id ? { ...e, ...patch } : e,
    );
    const nextActiveEnv =
      patch.name !== undefined && collection.activeEnvironment === selectedEnv.name
        ? patch.name
        : collection.activeEnvironment;
    onUpdateCollection({
      ...collection,
      environments: nextEnvs,
      activeEnvironment: nextActiveEnv,
    });
  };

  /* --- Auth Profile Operations --- */
  const handleAddAuthProfile = () => {
    const newProf: AuthProfile = {
      id: generateAwjcId('authprof'),
      name: `Auth Profile ${authProfiles.length + 1}`,
      type: 'oauth2',
      oauth2: {
        grantType: 'client_credentials',
        accessTokenUrl: '{{baseUrl}}/oauth/token',
        clientId: '{{clientId}}',
        clientSecret: '{{clientSecret}}',
        scope: '',
        clientAuthMethod: 'basic_header',
      },
    };
    onUpdateCollection({
      ...collection,
      authProfiles: [...authProfiles, newProf],
    });
    setSelectedProfileId(newProf.id);
  };

  const handleUpdateAuthProfile = (updated: AuthProfile) => {
    onUpdateCollection({
      ...collection,
      authProfiles: authProfiles.map(p => (p.id === updated.id ? updated : p)),
    });
  };

  const handleDeleteAuthProfile = (profId: string) => {
    const remaining = authProfiles.filter(p => p.id !== profId);
    onUpdateCollection({
      ...collection,
      authProfiles: remaining,
    });
    if (selectedProfileId === profId) {
      setSelectedProfileId(remaining[0]?.id ?? '');
    }
  };

  return (
    <div
      data-testid="environment-manager-modal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Environments, Variables & Secrets Manager"
        data-testid="environment-manager-modal"
        onKeyDown={handleDialogKeyDown}
        style={{
          position: 'fixed',
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          backgroundColor: colors.bgPrimary,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
          userSelect: isInteracting ? 'none' : 'auto',
        }}
      >
        {RESIZE_HANDLES.map(h => (
          <div
            key={h.dir}
            data-testid={`env-modal-resize-${h.dir}`}
            onMouseDown={e => handleResizeMouseDown(h.dir, e)}
            style={{ position: 'absolute', zIndex: 40, ...h.style }}
          />
        ))}

        {/* Modal Header (drag to move) */}
        <div
          data-testid="env-modal-header"
          onMouseDown={handleHeaderMouseDown}
          title="Drag to move"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: `1px solid ${colors.border}`,
            backgroundColor: colors.bgSecondary,
            cursor: 'move',
            userSelect: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Layers size={16} color={colors.accent} />
            <span style={{ fontWeight: 700, fontSize: 14 }}>
              Environments, Variables &amp; Secrets — {collection.metadata.name}
            </span>
          </div>

          <button
            type="button"
            data-testid="env-modal-close-btn"
            aria-label="Close modal"
            onClick={handleRequestClose}
            style={{
              border: 'none',
              background: 'transparent',
              color: colors.textSecondary,
              cursor: 'pointer',
              padding: 4,
              display: 'inline-flex',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Section Tabs */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            padding: '8px 16px',
            borderBottom: `1px solid ${colors.border}`,
            backgroundColor: colors.bgSecondary,
          }}
        >
          <button
            type="button"
            data-testid="env-modal-tab-environments"
            onClick={() => setActiveTab('environments')}
            style={tabBtnStyle(activeTab === 'environments', colors)}
          >
            Environments ({environments.length})
          </button>
          <button
            type="button"
            data-testid="env-modal-tab-collection-vars"
            onClick={() => setActiveTab('collectionVariables')}
            style={tabBtnStyle(activeTab === 'collectionVariables', colors)}
          >
            Collection Variables ({(collection.variables ?? []).length})
          </button>
          <button
            type="button"
            data-testid="env-modal-tab-auth-profiles"
            onClick={() => setActiveTab('authProfiles')}
            style={tabBtnStyle(activeTab === 'authProfiles', colors)}
          >
            <KeyRound size={12} />
            Auth Profiles ({authProfiles.length})
          </button>
        </div>

        {/* Body Content */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {activeTab === 'environments' && (
            <>
              {/* Left Environment List */}
              <div
                style={{
                  width: 230,
                  borderRight: `1px solid ${colors.border}`,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  overflowY: 'auto',
                }}
              >
                <button
                  type="button"
                  data-testid="env-add-btn"
                  onClick={handleAddEnvironment}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: 'none',
                    backgroundColor: colors.accent,
                    color: '#ffffff',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Plus size={13} />
                  New Environment
                </button>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {environments.map(env => {
                    const isSelected = selectedEnv?.id === env.id;
                    return (
                      <div
                        key={env.id}
                        data-testid={`env-list-item-${env.name}`}
                        onClick={() => setSelectedEnvId(env.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '6px 8px',
                          borderRadius: 6,
                          border: `1px solid ${isSelected ? colors.accent : 'transparent'}`,
                          backgroundColor: isSelected ? colors.bgSecondary : 'transparent',
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              backgroundColor: env.color ?? '#22c55e',
                            }}
                          />
                          <span style={{ fontWeight: isSelected ? 700 : 500 }}>{env.name}</span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <button
                            type="button"
                            data-testid={`env-duplicate-btn-${env.name}`}
                            title="Duplicate Environment"
                            onClick={e => {
                              e.stopPropagation();
                              handleDuplicateEnvironment(env);
                            }}
                            style={{
                              border: 'none',
                              background: 'transparent',
                              color: colors.textSecondary,
                              cursor: 'pointer',
                              padding: 2,
                            }}
                          >
                            <Copy size={12} />
                          </button>
                          <button
                            type="button"
                            data-testid={`env-delete-btn-${env.name}`}
                            title="Delete Environment"
                            onClick={e => {
                              e.stopPropagation();
                              handleDeleteEnvironment(env.id);
                            }}
                            style={{
                              border: 'none',
                              background: 'transparent',
                              color: colors.danger,
                              cursor: 'pointer',
                              padding: 2,
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right Selected Environment Editor */}
              <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
                {selectedEnv ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <label
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: colors.textSecondary,
                            display: 'block',
                            marginBottom: 4,
                          }}
                        >
                          Environment Name
                        </label>
                        <input
                          type="text"
                          aria-label="Environment Name"
                          data-testid="env-name-input"
                          value={selectedEnv.name}
                          onChange={e => handleUpdateSelectedEnv({ name: e.target.value })}
                          style={{
                            width: '100%',
                            padding: '6px 10px',
                            borderRadius: 6,
                            border: `1px solid ${colors.border}`,
                            backgroundColor: colors.bgSecondary,
                            color: colors.textPrimary,
                            fontSize: 13,
                            fontWeight: 600,
                          }}
                        />
                      </div>

                      <div>
                        <label
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: colors.textSecondary,
                            display: 'block',
                            marginBottom: 4,
                          }}
                        >
                          Color Tag
                        </label>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {ENV_COLOR_PALETTE.map(c => (
                            <button
                              key={c}
                              type="button"
                              data-testid={`env-color-swatch-${c}`}
                              onClick={() => handleUpdateSelectedEnv({ color: c })}
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: '50%',
                                backgroundColor: c,
                                border:
                                  selectedEnv.color === c
                                    ? `2px solid ${colors.textPrimary}`
                                    : '2px solid transparent',
                                cursor: 'pointer',
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>

                    <KeyValueTable
                      entries={selectedEnv.variables}
                      onChange={variables => handleUpdateSelectedEnv({ variables })}
                      keyPlaceholder="Variable Name"
                      valuePlaceholder="Environment Value"
                      testIdPrefix="env-vars"
                      onSecretToggled={(_, entry, isSecret) =>
                        persistSecretToggle(`env:${selectedEnv.id}`, entry, isSecret)
                      }
                    />
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: colors.textMuted }}>
                    No environments configured. Click &ldquo;New Environment&rdquo; to create one.
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === 'collectionVariables' && (
            <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
              <div style={{ marginBottom: 10, fontSize: 12, color: colors.textSecondary }}>
                Collection variables apply across all environments unless overridden by an active
                environment variable.
              </div>
              <KeyValueTable
                entries={collection.variables ?? []}
                onChange={variables => onUpdateCollection({ ...collection, variables })}
                keyPlaceholder="Collection Variable"
                valuePlaceholder="Default Value"
                testIdPrefix="collection-vars"
                onSecretToggled={(_, entry, isSecret) =>
                  persistSecretToggle('collection', entry, isSecret)
                }
              />
            </div>
          )}

          {activeTab === 'authProfiles' && (
            <>
              <div
                style={{
                  width: 230,
                  borderRight: `1px solid ${colors.border}`,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  overflowY: 'auto',
                }}
              >
                <button
                  type="button"
                  data-testid="auth-profile-add-btn"
                  onClick={handleAddAuthProfile}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: 'none',
                    backgroundColor: colors.accent,
                    color: '#ffffff',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Plus size={13} />
                  New Auth Profile
                </button>

                {authProfiles.map(prof => {
                  const isSelected = selectedProfile?.id === prof.id;
                  return (
                    <div
                      key={prof.id}
                      data-testid={`auth-profile-item-${prof.id}`}
                      onClick={() => setSelectedProfileId(prof.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 8px',
                        borderRadius: 6,
                        border: `1px solid ${isSelected ? colors.accent : 'transparent'}`,
                        backgroundColor: isSelected ? colors.bgSecondary : 'transparent',
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      <span>{prof.name}</span>
                      <button
                        type="button"
                        data-testid={`auth-profile-delete-${prof.id}`}
                        onClick={e => {
                          e.stopPropagation();
                          handleDeleteAuthProfile(prof.id);
                        }}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: colors.danger,
                          cursor: 'pointer',
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>

              <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
                {selectedProfile ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ maxWidth: 340 }}>
                      <label
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: colors.textSecondary,
                          display: 'block',
                          marginBottom: 4,
                        }}
                      >
                        Profile Name
                      </label>
                      <input
                        type="text"
                        data-testid="auth-profile-name-input"
                        value={selectedProfile.name}
                        onChange={e =>
                          handleUpdateAuthProfile({
                            ...selectedProfile,
                            name: e.target.value,
                          })
                        }
                        style={{
                          width: '100%',
                          padding: '6px 10px',
                          borderRadius: 6,
                          border: `1px solid ${colors.border}`,
                          backgroundColor: colors.bgSecondary,
                          color: colors.textPrimary,
                          fontSize: 13,
                          fontWeight: 600,
                        }}
                      />
                    </div>

                    <RequestAuthTab
                      auth={selectedProfile}
                      onChange={nextAuth =>
                        handleUpdateAuthProfile({
                          ...selectedProfile,
                          ...nextAuth,
                        })
                      }
                    />
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: colors.textMuted }}>
                    Create reusable OAuth 2.0, Bearer, Basic, or API Key auth profiles shared across
                    requests.
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer: Save / Cancel */}
        <div
          data-testid="env-modal-footer"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '10px 16px',
            borderTop: `1px solid ${colors.border}`,
            backgroundColor: colors.bgSecondary,
          }}
        >
          <div style={{ fontSize: 12, color: saveError ? colors.danger : colors.textSecondary }}>
            {saveError
              ? `Save failed: ${saveError}`
              : confirmDiscard
                ? 'You have unsaved changes. Discard them?'
                : hasEdits
                  ? 'Unsaved changes'
                  : ''}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {confirmDiscard ? (
              <>
                <button
                  type="button"
                  data-testid="env-modal-keep-editing-btn"
                  onClick={() => setConfirmDiscard(false)}
                  style={secondaryBtnStyle(colors.border, colors.textPrimary)}
                >
                  Keep Editing
                </button>
                <button
                  type="button"
                  data-testid="env-modal-discard-btn"
                  onClick={onClose}
                  style={secondaryBtnStyle(colors.danger, colors.danger)}
                >
                  Discard Changes
                </button>
              </>
            ) : (
              <button
                type="button"
                data-testid="env-modal-cancel-btn"
                onClick={handleRequestClose}
                style={secondaryBtnStyle(colors.border, colors.textPrimary)}
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              data-testid="env-modal-save-btn"
              title="Save (Cmd/Ctrl+S)"
              disabled={isSaving}
              onClick={() => void handleSave()}
              style={{
                padding: '7px 14px',
                borderRadius: 6,
                border: 'none',
                backgroundColor: colors.accent,
                color: '#ffffff',
                fontSize: 12,
                fontWeight: 600,
                cursor: isSaving ? 'wait' : 'pointer',
                opacity: isSaving ? 0.7 : 1,
              }}
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

function secondaryBtnStyle(borderColor: string, textColor: string): React.CSSProperties {
  return {
    padding: '7px 14px',
    borderRadius: 6,
    border: `1px solid ${borderColor}`,
    backgroundColor: 'transparent',
    color: textColor,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  };
}

function tabBtnStyle(
  active: boolean,
  colors: { accent: string; textSecondary: string; border: string },
): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 12px',
    borderRadius: 6,
    border: `1px solid ${active ? colors.accent : colors.border}`,
    backgroundColor: active ? `${colors.accent}22` : 'transparent',
    color: active ? colors.accent : colors.textSecondary,
    fontSize: 12,
    fontWeight: active ? 700 : 500,
    cursor: 'pointer',
  };
}
