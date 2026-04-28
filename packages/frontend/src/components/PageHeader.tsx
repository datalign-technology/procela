import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  children?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}

export default function PageHeader({ title, subtitle, children, actions, meta }: PageHeaderProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>{title}</h1>
          {children}
        </div>
        {subtitle && (
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>{subtitle}</p>
        )}
        {meta && <div style={{ marginTop: 6 }}>{meta}</div>}
      </div>
      {actions && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{actions}</div>
      )}
    </div>
  );
}
