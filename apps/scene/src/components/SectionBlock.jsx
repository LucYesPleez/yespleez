export default function SectionBlock({ title, accent, accent2, className, titleClassName, titleStyle, children }) {
  return (
    <div className={className}>
      {title != null && (
        <div
          className={titleClassName}
          style={{ borderImage: `linear-gradient(90deg, ${accent}, ${accent2}) 1`, ...titleStyle }}
        >
          {title}
        </div>
      )}
      {children}
    </div>
  );
}
