import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Edit2, Eye, EyeOff, Send, Square } from 'lucide-react';
import {
  inspectVariablesInText,
  type InspectedVariableToken,
  type VariableInterpolationContext,
} from '../../../shared/interpolation';
import { extractPathParamNames } from '../../../shared/urlParams';
import type { PathParamEntry } from '../../../shared/collectionSchema';
import { useTheme } from '../context/ThemeContext';

const STANDARD_VERBS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'TRACE',
  'CONNECT',
  'GRAPHQL',
];

export interface RequestUrlBarProps {
  method: string;
  protocol?: 'http' | 'graphql';
  url: string;
  pathParams?: PathParamEntry[];
  interpolationContext?: VariableInterpolationContext;
  isSending?: boolean;
  onMethodChange: (method: string, protocol?: 'http' | 'graphql') => void;
  onUrlChange: (url: string) => void;
  onSend: () => void;
  onCancel?: () => void;
  onEditVariable?: (variableName: string, scope: string) => void;
}

export function formatScopeLabel(source: InspectedVariableToken['source']): string {
  switch (source) {
    case 'environment':
      return 'Environment';
    case 'collection':
      return 'Collection';
    case 'folder':
      return 'Folder';
    case 'captured':
      return 'Captured';
    case 'dynamic':
      return 'Dynamic';
    case 'global':
      return 'Global';
    case 'unresolved':
    default:
      return 'Unresolved';
  }
}

export const RequestUrlBar: React.FC<RequestUrlBarProps> = ({
  method,
  url,
  pathParams = [],
  interpolationContext = {},
  isSending = false,
  onMethodChange,
  onUrlChange,
  onSend,
  onCancel,
  onEditVariable,
}) => {
  const { colors, isLight } = useTheme();
  const [isCustomVerb, setIsCustomVerb] = useState<boolean>(
    !STANDARD_VERBS.includes(method.toUpperCase()),
  );
  const [hoveredVar, setHoveredVar] = useState<InspectedVariableToken | null>(null);
  const [revealSecret, setRevealSecret] = useState<boolean>(false);
  const [allowHoverAtMs, setAllowHoverAtMs] = useState<number>(0);
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHoverCloseTimer = () => {
    if (hoverCloseTimerRef.current) {
      clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  };

  const scheduleHoverClose = () => {
    clearHoverCloseTimer();
    hoverCloseTimerRef.current = setTimeout(() => {
      setHoveredVar(null);
    }, 150);
  };

  useEffect(() => {
    setHoveredVar(null);
    setAllowHoverAtMs(Date.now() + 250);
  }, [url]);

  useEffect(() => {
    if (!hoveredVar) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-testid="variable-hover-popover"], [data-url-var-pill]')) {
        return;
      }
      setHoveredVar(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setHoveredVar(null);
      }
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [hoveredVar]);

  const inspectedTokens = useMemo(
    () => inspectVariablesInText(url, interpolationContext),
    [url, interpolationContext],
  );

  const pathParamNames = useMemo(() => extractPathParamNames(url), [url]);

  const handleSelectMethod = (val: string) => {
    if (val === '__CUSTOM__') {
      setIsCustomVerb(true);
      return;
    }
    setIsCustomVerb(false);
    if (val === 'GRAPHQL') {
      onMethodChange('POST', 'graphql');
    } else {
      onMethodChange(val, 'http');
    }
  };

  return (
    <div
      data-testid="request-url-bar"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* HTTP Method Dropdown (+ Custom Verb Option) */}
        <select
          aria-label="HTTP Method"
          data-testid="method-select"
          value={isCustomVerb ? '__CUSTOM__' : method.toUpperCase()}
          onChange={e => handleSelectMethod(e.target.value)}
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            border: `1px solid ${colors.border}`,
            backgroundColor: colors.bgSecondary,
            color: colors.textPrimary,
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          {STANDARD_VERBS.map(verb => (
            <option key={verb} value={verb}>
              {verb}
            </option>
          ))}
          <option value="__CUSTOM__">Custom...</option>
        </select>

        {isCustomVerb && (
          <input
            type="text"
            aria-label="Custom HTTP Verb"
            data-testid="custom-method-input"
            value={method}
            placeholder="PROPFIND"
            onChange={e => onMethodChange(e.target.value.toUpperCase(), 'http')}
            style={{
              width: 110,
              padding: '8px 10px',
              borderRadius: 6,
              border: `1px solid ${colors.accent}`,
              backgroundColor: colors.bgSecondary,
              color: colors.textPrimary,
              fontWeight: 700,
              fontSize: 12,
              fontFamily: 'monospace',
            }}
          />
        )}

        {/* URL Input */}
        <input
          type="text"
          aria-label="Request URL"
          data-testid="url-input"
          value={url}
          placeholder="https://{{baseUrl}}/v1/users/:id"
          onChange={e => onUrlChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (!isSending) onSend();
            }
          }}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: 6,
            border: `1px solid ${colors.border}`,
            backgroundColor: isLight ? '#ffffff' : '#1e293b',
            color: colors.textPrimary,
            fontFamily: 'monospace',
            fontSize: 13,
          }}
        />

        {/* Send / Cancel Button */}
        {isSending ? (
          <button
            type="button"
            data-testid="cancel-request-btn"
            onClick={onCancel}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              borderRadius: 6,
              border: 'none',
              backgroundColor: colors.danger,
              color: '#ffffff',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            <Square size={13} />
            Cancel
          </button>
        ) : (
          <button
            type="button"
            data-testid="send-request-btn"
            onClick={onSend}
            title="Send Request (Enter)"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              borderRadius: 6,
              border: 'none',
              backgroundColor: colors.accent,
              color: '#ffffff',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            <Send size={14} />
            Send
          </button>
        )}
      </div>

      {/* Live Variable & Path Parameter Token Strip */}
      {(inspectedTokens.length > 0 || pathParamNames.length > 0) && (
        <div
          data-testid="url-tokens-bar"
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 6,
            fontSize: 11,
          }}
        >
          {inspectedTokens.map((token, idx) => {
            const isResolved = token.isResolved;
            const badgeBg = isResolved
              ? isLight
                ? '#dcfce7'
                : '#14532d'
              : isLight
                ? '#fee2e2'
                : '#7f1d1d';
            const badgeText = isResolved
              ? isLight
                ? '#15803d'
                : '#4ade80'
              : isLight
                ? '#b91c1c'
                : '#fca5a5';

            return (
              <span
                key={`${token.name}_${idx}`}
                data-url-var-pill="true"
                data-testid={`url-var-pill-${token.name}`}
                data-resolved={String(isResolved)}
                onMouseEnter={e => {
                  if (e.isTrusted && Date.now() < allowHoverAtMs) {
                    return;
                  }
                  clearHoverCloseTimer();
                  setHoveredVar(token);
                  setRevealSecret(false);
                }}
                onMouseLeave={scheduleHoverClose}
                onClick={() => {
                  clearHoverCloseTimer();
                  setHoveredVar(token);
                  setRevealSecret(false);
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  borderRadius: 999,
                  backgroundColor: badgeBg,
                  color: badgeText,
                  fontFamily: 'monospace',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {token.rawToken}
              </span>
            );
          })}

          {pathParamNames.map(paramName => {
            const matched = pathParams.find(p => p.key === paramName);
            const hasVal = Boolean(matched?.value && matched.value.trim().length > 0);
            return (
              <span
                key={`path_${paramName}`}
                data-testid={`url-path-pill-${paramName}`}
                data-resolved={String(hasVal)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  borderRadius: 999,
                  backgroundColor: isLight ? '#e0f2fe' : '#0c4a6e',
                  color: isLight ? '#0369a1' : '#38bdf8',
                  fontFamily: 'monospace',
                  fontWeight: 600,
                }}
              >
                :{paramName}={hasVal ? matched?.value : '(empty)'}
              </span>
            );
          })}
        </div>
      )}

      {/* Hover Popover for {{Variable}} Inspection */}
      {hoveredVar && (
        <div
          data-testid="variable-hover-popover"
          onMouseEnter={clearHoverCloseTimer}
          onMouseLeave={() => {
            clearHoverCloseTimer();
            setHoveredVar(null);
          }}
          style={{
            position: 'absolute',
            top: '100%',
            left: 90,
            marginTop: 6,
            zIndex: 50,
            backgroundColor: colors.bgSecondary,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            padding: '10px 12px',
            minWidth: 280,
            boxShadow: '0 10px 25px rgba(0,0,0,0.4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: colors.textPrimary }}>
              {hoveredVar.rawToken}
            </span>
            <span
              data-testid="variable-popover-scope"
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: 4,
                backgroundColor: colors.bgTertiary,
                color: hoveredVar.isResolved ? colors.accent : colors.danger,
              }}
            >
              {formatScopeLabel(hoveredVar.source)}
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '6px 8px',
              borderRadius: 4,
              backgroundColor: colors.bgPrimary,
              fontFamily: 'monospace',
              fontSize: 12,
            }}
          >
            <span data-testid="variable-popover-value" style={{ wordBreak: 'break-all' }}>
              {!hoveredVar.isResolved
                ? 'Unresolved variable'
                : hoveredVar.isSecret && !revealSecret
                  ? '••••••••'
                  : hoveredVar.resolvedValue}
            </span>

            {hoveredVar.isSecret && (
              <button
                type="button"
                data-testid="variable-secret-reveal-btn"
                aria-label={revealSecret ? 'Hide secret value' : 'Reveal secret value'}
                onClick={() => setRevealSecret(prev => !prev)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: colors.textSecondary,
                  cursor: 'pointer',
                  padding: 2,
                  display: 'inline-flex',
                }}
              >
                {revealSecret ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              type="button"
              data-testid="variable-popover-close-btn"
              onClick={() => setHoveredVar(null)}
              style={{
                border: 'none',
                background: 'transparent',
                color: colors.textSecondary,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Dismiss
            </button>

            {onEditVariable && (
              <button
                type="button"
                data-testid="variable-quick-edit-btn"
                onClick={() => {
                  onEditVariable(hoveredVar.name, hoveredVar.source);
                  setHoveredVar(null);
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 8px',
                  borderRadius: 4,
                  border: `1px solid ${colors.border}`,
                  backgroundColor: colors.bgPrimary,
                  color: colors.textPrimary,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                <Edit2 size={11} />
                Quick Edit
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
