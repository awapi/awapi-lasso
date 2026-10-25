import React, { useEffect, useState } from 'react';
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
  onUpdateCollection: (collection: AwjcCollection) => void;
  onClose: () => void;
}

export const EnvironmentManagerModal: React.FC<EnvironmentManagerModalProps> = ({
  isOpen,
  initialTab = 'environments',
  collection,
  onUpdateCollection,
  onClose,
}) => {
  const { colors } = useTheme();
  const [activeTab, setActiveTab] = useState<EnvironmentModalTab>(initialTab);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

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

  if (!isOpen) return null;

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
    const coord = {
      collectionId: collection.metadata.id,
      scopeId,
      key: entry.key,
    };
    if (isSecret) {
      void window.electronAPI?.setSecret?.(coord, entry.value ?? '');
    } else {
      void window.electronAPI?.deleteSecret?.(coord);
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
      patch.name && collection.activeEnvironment === selectedEnv.name
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
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Environments, Variables & Secrets Manager"
        data-testid="environment-manager-modal"
        style={{
          width: '100%',
          maxWidth: 940,
          height: '80vh',
          backgroundColor: colors.bgPrimary,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: `1px solid ${colors.border}`,
            backgroundColor: colors.bgSecondary,
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
            onClick={onClose}
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
                        persistSecretToggle(`env:${selectedEnv.name}`, entry, isSecret)
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
      </div>
    </div>
  );
};

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
