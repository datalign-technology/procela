import type { ReactNode, CSSProperties } from 'react';

interface SectionCardProps {
  title?: string;
  children: ReactNode;
  padding?: number | string;
  marginBottom?: number | string;
  shadow?: boolean;
  overflow?: CSSProperties['overflow'];
  style?: CSSProperties;
}

export default function SectionCard({ title, children, padding = 20, marginBottom = 20, shadow = true, overflow, style }: SectionCardProps) {
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      padding,
      marginBottom,
      boxShadow: shadow ? 'var(--shadow-sm)' : undefined,
      overflow,
      ...style,
    }}>
      {title && (
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>{title}</h3>
      )}
      {children}
    </div>
  );
}
