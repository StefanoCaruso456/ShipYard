import { attachmentBadge, formatAttachmentSize } from "../attachments";
import type { AttachmentCard } from "../types";

type AttachmentPreviewListProps = {
  attachments: AttachmentCard[];
  onRemove?: (attachmentId: string) => void;
};

export function AttachmentPreviewList({
  attachments,
  onRemove
}: AttachmentPreviewListProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="attachment-preview-list">
      {attachments.map((attachment) => (
        <article key={attachment.id} className="attachment-preview-card">
          <div className="attachment-preview-card__media">
            {attachment.previewUrl ? (
              <img src={attachment.previewUrl} alt={attachment.name} className="attachment-preview-card__image" />
            ) : (
              <div className="attachment-preview-card__badge">{attachmentBadge(attachment.kind, attachment.name)}</div>
            )}
          </div>

          <div className="attachment-preview-card__body">
            <div className="attachment-preview-card__meta">
              <strong title={attachment.name}>{attachment.name}</strong>
              <span>{formatAttachmentSize(attachment.size)}</span>
            </div>
            <p>{attachment.summary}</p>
            {attachment.excerpt ? <pre>{attachment.excerpt}</pre> : null}
          </div>

          {onRemove ? (
            <button
              type="button"
              className="attachment-preview-card__remove"
              aria-label={`Remove ${attachment.name}`}
              onClick={() => onRemove(attachment.id)}
            >
              ×
            </button>
          ) : null}
        </article>
      ))}
    </div>
  );
}
