import { Fragment, useMemo, useState, type ReactNode } from "react";

import type { ThreadMessage } from "../types";
import { AttachmentPreviewList } from "./AttachmentPreviewList";

type ThreadMessageCardProps = {
  message: ThreadMessage;
};

type MessageBlock =
  | {
      type: "heading";
      text: string;
      level: 2 | 3;
    }
  | {
      type: "paragraph";
      text: string;
    }
  | {
      type: "list";
      ordered: boolean;
      items: string[];
    }
  | {
      type: "code";
      language: string | null;
      code: string;
    }
  | {
      type: "table";
      headers: string[];
      rows: string[][];
    };

const COLLAPSE_BODY_LENGTH = 680;
const COLLAPSE_LINE_COUNT = 12;

export function ThreadMessageCard({ message }: ThreadMessageCardProps) {
  const hasStructuredContent = useMemo(() => containsStructuredContent(message.body), [message.body]);
  const collapsible = shouldCollapseMessage(message, hasStructuredContent);
  const [expanded, setExpanded] = useState(!collapsible);
  const blocks = useMemo(() => parseMessageBlocks(message.body), [message.body]);
  const preview = useMemo(() => createCollapsedPreview(message.body), [message.body]);

  return (
    <article
      className={`message message--${message.role} message--tone-${message.tone} ${
        hasStructuredContent ? "message--structured" : "message--plain"
      }`}
    >
      <div className="message__meta">
        <span>{message.timestamp}</span>
      </div>

      <div className="message__body">
        {expanded ? (
          <div className="message__content">
            {blocks.map((block, index) => renderBlock(block, `${message.id}-block-${index}`))}
          </div>
        ) : (
          <p className="message__preview">{preview}</p>
        )}

        {collapsible ? (
          <button
            type="button"
            className="message__toggle"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "Collapse" : deriveToggleLabel(message)}
          </button>
        ) : null}

        {message.attachments && message.attachments.length > 0 ? (
          <div className="message__attachments">
            <AttachmentPreviewList attachments={message.attachments} variant="compact" />
          </div>
        ) : null}
      </div>
    </article>
  );
}

function renderBlock(block: MessageBlock, key: string) {
  switch (block.type) {
    case "heading":
      return block.level === 2 ? (
        <h3 key={key} className="message__heading">
          {renderInlineContent(block.text, key)}
        </h3>
      ) : (
        <h4 key={key} className="message__subheading">
          {renderInlineContent(block.text, key)}
        </h4>
      );
    case "paragraph":
      return (
        <p key={key} className="message__paragraph">
          {renderInlineContent(block.text, key)}
        </p>
      );
    case "list":
      return block.ordered ? (
        <ol key={key} className="message__list message__list--ordered">
          {block.items.map((item, index) => (
            <li key={`${key}-item-${index}`}>{renderInlineContent(item, `${key}-item-${index}`)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key} className="message__list">
          {block.items.map((item, index) => (
            <li key={`${key}-item-${index}`}>{renderInlineContent(item, `${key}-item-${index}`)}</li>
          ))}
        </ul>
      );
    case "code":
      return (
        <div key={key} className="message__code-block">
          {block.language ? <span className="message__code-label">{block.language}</span> : null}
          <pre className="message__code">
            <code>{block.code}</code>
          </pre>
        </div>
      );
    case "table":
      return (
        <div key={key} className="message__table-wrap">
          <table className="message__table">
            <thead>
              <tr>
                {block.headers.map((header, index) => (
                  <th key={`${key}-header-${index}`}>{renderInlineContent(header, `${key}-header-${index}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={`${key}-row-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${key}-row-${rowIndex}-cell-${cellIndex}`}>
                      {renderInlineContent(cell, `${key}-row-${rowIndex}-cell-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function renderInlineContent(text: string, keyPrefix: string) {
  const pattern = /(\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*)/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null = pattern.exec(text);

  while (match) {
    if (match.index > lastIndex) {
      nodes.push(renderTextSegment(text.slice(lastIndex, match.index), `${keyPrefix}-text-${lastIndex}`));
    }

    if (match[2] && match[3]) {
      nodes.push(
        <a
          key={`${keyPrefix}-link-${match.index}`}
          className="message__link"
          href={match[3]}
          target="_blank"
          rel="noreferrer"
        >
          {match[2]}
        </a>
      );
    } else if (match[4]) {
      nodes.push(
        <code key={`${keyPrefix}-code-${match.index}`} className="message__inline-code">
          {match[4]}
        </code>
      );
    } else if (match[5]) {
      nodes.push(
        <strong key={`${keyPrefix}-strong-${match.index}`} className="message__strong">
          {match[5]}
        </strong>
      );
    }

    lastIndex = match.index + match[0].length;
    match = pattern.exec(text);
  }

  if (lastIndex < text.length) {
    nodes.push(renderTextSegment(text.slice(lastIndex), `${keyPrefix}-tail`));
  }

  return nodes.length > 0 ? nodes : text;
}

function renderTextSegment(text: string, key: string) {
  const lines = text.split("\n");

  return (
    <Fragment key={key}>
      {lines.map((line, index) => (
        <Fragment key={`${key}-line-${index}`}>
          {line}
          {index < lines.length - 1 ? <br /> : null}
        </Fragment>
      ))}
    </Fragment>
  );
}

function parseMessageBlocks(body: string): MessageBlock[] {
  const normalized = body.replace(/\r\n/g, "\n").trim();

  if (!normalized) {
    return [
      {
        type: "paragraph",
        text: ""
      }
    ];
  }

  const lines = normalized.split("\n");
  const blocks: MessageBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const rawLine = lines[index] ?? "";
    const line = rawLine.trim();

    if (!line) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const language = line.slice(3).trim() || null;
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !lines[index]?.trim().startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      blocks.push({
        type: "code",
        language,
        code: codeLines.join("\n")
      });
      continue;
    }

    if (isTableStart(lines, index)) {
      const tableLines: string[] = [];

      while (index < lines.length && lines[index]?.trim().startsWith("|")) {
        tableLines.push(lines[index] ?? "");
        index += 1;
      }

      const [headerLine, , ...rowLines] = tableLines;

      blocks.push({
        type: "table",
        headers: parseTableRow(headerLine ?? ""),
        rows: rowLines.map((row) => parseTableRow(row))
      });
      continue;
    }

    const hashHeading = line.match(/^(#{1,3})\s+(.+)$/);

    if (hashHeading) {
      blocks.push({
        type: "heading",
        level: hashHeading[1].length === 1 ? 2 : 3,
        text: hashHeading[2].trim()
      });
      index += 1;
      continue;
    }

    const strongHeading = line.match(/^\*\*(.+)\*\*$/);

    if (strongHeading) {
      blocks.push({
        type: "heading",
        level: 2,
        text: strongHeading[1].trim()
      });
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];

      while (index < lines.length && /^[-*]\s+/.test(lines[index]?.trim() ?? "")) {
        items.push((lines[index] ?? "").trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }

      blocks.push({
        type: "list",
        ordered: false,
        items
      });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];

      while (index < lines.length && /^\d+\.\s+/.test(lines[index]?.trim() ?? "")) {
        items.push((lines[index] ?? "").trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }

      blocks.push({
        type: "list",
        ordered: true,
        items
      });
      continue;
    }

    const paragraphLines: string[] = [rawLine.trim()];
    index += 1;

    while (index < lines.length) {
      const nextLine = lines[index] ?? "";
      const nextTrimmed = nextLine.trim();

      if (!nextTrimmed || startsNewBlock(lines, index)) {
        break;
      }

      paragraphLines.push(nextLine.trim());
      index += 1;
    }

    blocks.push({
      type: "paragraph",
      text: paragraphLines.join(" ")
    });
  }

  return blocks;
}

function startsNewBlock(lines: string[], index: number) {
  const line = lines[index]?.trim() ?? "";
  const nextLine = lines[index + 1]?.trim() ?? "";

  return (
    !line ||
    line.startsWith("```") ||
    /^(#{1,3})\s+/.test(line) ||
    /^\*\*(.+)\*\*$/.test(line) ||
    /^[-*]\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    (line.startsWith("|") && /^\|?[\s:|-]+\|?$/.test(nextLine))
  );
}

function isTableStart(lines: string[], index: number) {
  const line = lines[index]?.trim() ?? "";
  const nextLine = lines[index + 1]?.trim() ?? "";

  return line.startsWith("|") && /^\|?[\s:|-]+\|?$/.test(nextLine);
}

function parseTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function shouldCollapseMessage(message: ThreadMessage, hasStructuredContent: boolean) {
  const lineCount = message.body.split("\n").length;
  const isLong = message.body.length >= COLLAPSE_BODY_LENGTH || lineCount >= COLLAPSE_LINE_COUNT;

  if (!isLong) {
    return false;
  }

  if (message.role === "assistant") {
    return !hasStructuredContent;
  }

  return true;
}

function createCollapsedPreview(body: string) {
  const compact = body
    .replace(/```[\s\S]*?```/g, " [code block] ")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (compact.length <= 320) {
    return compact;
  }

  return `${compact.slice(0, 317).trimEnd()}...`;
}

function containsStructuredContent(body: string) {
  return (
    /^(#{1,3})\s+/m.test(body) ||
    /^\*\*(.+)\*\*$/m.test(body) ||
    /^[-*]\s+/m.test(body) ||
    /^\d+\.\s+/m.test(body) ||
    /```/.test(body) ||
    /^\|.+\|$/m.test(body)
  );
}

function deriveToggleLabel(message: ThreadMessage) {
  if (message.role === "user") {
    return "Show full prompt";
  }

  if (message.role === "system") {
    return "Show full note";
  }

  return "Show full message";
}
