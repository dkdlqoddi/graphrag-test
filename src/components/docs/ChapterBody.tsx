/** Renders the chapter markdown body (headings + paragraphs) as HTML. */
export function ChapterBody({ body }: { body: string }) {
  const blocks = body.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <>
      {blocks.map((raw, i) => {
        const text = raw.trim();
        if (!text) return null;
        if (text.startsWith("### ")) return <h3 key={i}>{text.slice(4)}</h3>;
        if (text.startsWith("## ")) return <h2 key={i}>{text.slice(3)}</h2>;
        if (text.startsWith("# ")) return <h1 key={i}>{text.slice(2)}</h1>;
        return <p key={i}>{text}</p>;
      })}
    </>
  );
}
