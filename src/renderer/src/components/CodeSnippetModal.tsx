import React, { useMemo, useState } from 'react';
import { Check, Code2, Copy, X } from 'lucide-react';
import type {
  AuthConfig,
  AuthProfile,
  KeyValueEntry,
  RequestItem,
} from '../../../shared/collectionSchema';
import type { VariableInterpolationContext } from '../../../shared/interpolation';
import {
  CODE_GENERATOR_TARGETS,
  generateCodeSnippet,
  type CodeGeneratorTarget,
} from '../../../shared/codeGenerator';
import { useTheme } from '../context/ThemeContext';

export interface CodeSnippetModalProps {
  isOpen: boolean;
  request: RequestItem;
  interpolationContext?: VariableInterpolationContext;
  inheritedHeaders?: KeyValueEntry[];
  collectionDefaultAuth?: AuthConfig;
  authProfiles?: AuthProfile[];
  onClose: () => void;
}

export const CodeSnippetModal: React.FC<CodeSnippetModalProps> = ({
  isOpen,
  request,
  interpolationContext = {},
  inheritedHeaders = [],
  collectionDefaultAuth,
  authProfiles,
  onClose,
}) => {
  const { colors, isLight } = useTheme();
  const [target, setTarget] = useState<CodeGeneratorTarget>('curl-bash');
  const [resolveVariables, setResolveVariables] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);

  const snippet = useMemo(
    () =>
      generateCodeSnippet({
        request,
        target,
        resolveVariables,
        interpolationContext,
        inheritedHeaders,
        collectionDefaultAuth,
        authProfiles,
      }),
    [
      request,
      target,
      resolveVariables,
      interpolationContext,
      inheritedHeaders,
      collectionDefaultAuth,
      authProfiles,
    ],
  );

  if (!isOpen) return null;

  const handleCopy = async () => {
    if (window.electronAPI?.copyToClipboard) {
      await window.electronAPI.copyToClipboard(snippet);
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(snippet);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      data-testid="code-snippet-modal-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 180,
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Generate Code Snippet"
        data-testid="code-snippet-modal"
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 780,
          maxHeight: '85vh',
          backgroundColor: colors.bgPrimary,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.45)',
        }}
      >
        {/* Header */}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Code2 size={16} color={colors.accent} />
            <span style={{ fontWeight: 700, fontSize: 14, color: colors.textPrimary }}>
              Code Snippet Generator — {request.name}
            </span>
          </div>
          <button
            type="button"
            data-testid="close-code-snippet-modal-btn"
            aria-label="Close Code Snippet Modal"
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

        {/* Target Language Bar + Variable Toggle + Copy */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '10px 16px',
            borderBottom: `1px solid ${colors.border}`,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <label
              htmlFor="code-target-select"
              style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary }}
            >
              Language:
            </label>
            <select
              id="code-target-select"
              aria-label="Target Language"
              data-testid="code-target-select"
              value={target}
              onChange={e => setTarget(e.target.value as CodeGeneratorTarget)}
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                border: `1px solid ${colors.border}`,
                backgroundColor: colors.bgSecondary,
                color: colors.textPrimary,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {CODE_GENERATOR_TARGETS.map(item => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>

            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: colors.textPrimary,
                cursor: 'pointer',
                marginLeft: 8,
              }}
            >
              <input
                type="checkbox"
                data-testid="resolve-variables-toggle"
                checked={resolveVariables}
                onChange={e => setResolveVariables(e.target.checked)}
              />
              Inline resolved {'{{variables}}'}
            </label>
          </div>

          <button
            type="button"
            data-testid="copy-code-snippet-btn"
            onClick={() => void handleCopy()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 6,
              border: 'none',
              backgroundColor: colors.accent,
              color: '#ffffff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied!' : 'Copy Snippet'}
          </button>
        </div>

        {/* Code Output */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: 16,
            backgroundColor: isLight ? '#f8fafc' : '#0b1120',
          }}
        >
          <pre
            data-testid="code-snippet-output"
            style={{
              margin: 0,
              fontFamily: 'monospace',
              fontSize: 12,
              lineHeight: 1.55,
              color: colors.textPrimary,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {snippet}
          </pre>
        </div>
      </div>
    </div>
  );
};
