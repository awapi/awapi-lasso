import React from 'react';
import { useTheme } from '../context/ThemeContext';
import { parseMarkdown, type MdBlock, type MdInline } from '../markdown';

type Colors = ReturnType<typeof useTheme>['colors'];

const InlineView: React.FC<{ nodes: MdInline[]; colors: Colors }> = ({ nodes, colors }) => (
  <>
    {nodes.map((node, i) => {
      switch (node.type) {
        case 'text':
          return <React.Fragment key={i}>{node.text}</React.Fragment>;
        case 'code':
          return (
            <code
              key={i}
              style={{
                fontFamily: 'monospace',
                fontSize: '0.92em',
                padding: '0 4px',
                borderRadius: 3,
                backgroundColor: colors.bgPrimary,
                border: `1px solid ${colors.border}`,
                whiteSpace: 'pre-wrap',
              }}
            >
              {node.text}
            </code>
          );
        case 'strong':
          return (
            <strong key={i}>
              <InlineView nodes={node.children} colors={colors} />
            </strong>
          );
        case 'em':
          return (
            <em key={i}>
              <InlineView nodes={node.children} colors={colors} />
            </em>
          );
        case 'link':
          // Not clickable on purpose: links come from model output and would navigate the app window.
          return (
            <span key={i} data-testid="ai-md-link" title={node.url} style={{ color: colors.accent }}>
              {node.text}
              {node.text !== node.url && <span style={{ color: colors.textMuted }}> ({node.url})</span>}
            </span>
          );
        default:
          return null;
      }
    })}
  </>
);

const Lines: React.FC<{ lines: MdInline[][]; colors: Colors }> = ({ lines, colors }) => (
  <>
    {lines.map((line, i) => (
      <React.Fragment key={i}>
        {i > 0 && <br />}
        <InlineView nodes={line} colors={colors} />
      </React.Fragment>
    ))}
  </>
);

const HEADING_SIZES = [16, 15, 14, 13, 13, 13];

const BlockView: React.FC<{ block: MdBlock; colors: Colors }> = ({ block, colors }) => {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${Math.min(block.level + 2, 6)}` as 'h3';
      return (
        <Tag style={{ margin: '8px 0 4px', fontSize: HEADING_SIZES[block.level - 1], fontWeight: 600 }}>
          <InlineView nodes={block.content} colors={colors} />
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p style={{ margin: '4px 0' }}>
          <Lines lines={block.lines} colors={colors} />
        </p>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag start={block.ordered ? block.start : undefined} style={{ margin: '4px 0', paddingLeft: 20 }}>
          {block.items.map((item, i) => (
            <li key={i} style={{ marginLeft: item.depth * 16 }}>
              <InlineView nodes={item.content} colors={colors} />
            </li>
          ))}
        </Tag>
      );
    }
    case 'quote':
      return (
        <blockquote
          style={{
            margin: '4px 0',
            padding: '2px 8px',
            borderLeft: `3px solid ${colors.border}`,
            color: colors.textSecondary,
          }}
        >
          <Lines lines={block.lines} colors={colors} />
        </blockquote>
      );
    case 'table':
      return (
        <div style={{ overflowX: 'auto', margin: '6px 0' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th
                    key={i}
                    style={{
                      textAlign: block.align[i] ?? 'left',
                      padding: '3px 8px',
                      borderBottom: `1px solid ${colors.border}`,
                      fontWeight: 600,
                    }}
                  >
                    <InlineView nodes={cell} colors={colors} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {block.header.map((_, c) => (
                    <td
                      key={c}
                      style={{
                        textAlign: block.align[c] ?? 'left',
                        padding: '3px 8px',
                        borderBottom: `1px solid ${colors.border}`,
                      }}
                    >
                      <InlineView nodes={row[c] ?? []} colors={colors} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'rule':
      return <hr style={{ border: 'none', borderTop: `1px solid ${colors.border}`, margin: '8px 0' }} />;
    default:
      return null;
  }
};

/** Renders assistant prose as a safe Markdown subset (React elements only; links are shown, not followed). */
export const AiMarkdown: React.FC<{ text: string }> = ({ text }) => {
  const { colors } = useTheme();
  return (
    <div data-testid="ai-markdown" style={{ whiteSpace: 'normal' }}>
      {parseMarkdown(text).map((block, i) => (
        <BlockView key={i} block={block} colors={colors} />
      ))}
    </div>
  );
};
