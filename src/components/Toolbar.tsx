import { ReactNode } from 'react';

interface ToolbarProps {
  children: ReactNode;
  className?: string;
}

export function Toolbar({ children, className = '' }: ToolbarProps) {
  return (
    <div className={['flex items-center gap-1', className].join(' ')}>
      {children}
    </div>
  );
}
