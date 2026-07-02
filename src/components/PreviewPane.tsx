interface PreviewPaneProps {
  html: string;
}

export function PreviewPane({ html }: PreviewPaneProps) {
  return (
    <section className="pane preview-pane">
      <div className="pane-header">
        <span className="dot" />
        Markdown Preview
      </div>
      <article className="preview-body markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  );
}
