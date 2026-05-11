"use client";

interface SpreadsheetEmbedProps {
  src: string;
  title?: string;
  width?: string;
  height?: string;
}

export default function SpreadsheetEmbed({
  src,
  title = "Embedded Spreadsheet",
  width = "100%",
  height = "600px",
}: SpreadsheetEmbedProps) {
  return (
    <iframe
      src={src}
      title={title}
      width={width}
      height={height}
      style={{
        border: "1px solid var(--gray-alpha-200)",
        borderRadius: "8px",
      }}
      allowFullScreen
    />
  );
}
