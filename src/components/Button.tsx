import { ButtonHTMLAttributes, forwardRef } from 'react';

type Variant = 'primary' | 'ghost' | 'danger' | 'secondary';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-violet-500 hover:bg-violet-600 text-white border-transparent',
  secondary: 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border-zinc-700',
  ghost: 'bg-transparent hover:bg-zinc-800 text-zinc-300 hover:text-zinc-100 border-transparent',
  danger: 'bg-transparent hover:bg-red-950 text-zinc-400 hover:text-red-400 border-transparent',
};

const sizeClasses: Record<Size, string> = {
  sm: 'px-2 py-1 text-xs gap-1',
  md: 'px-3 py-1.5 text-sm gap-1.5',
  lg: 'px-4 py-2 text-sm gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', className = '', children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={[
          'inline-flex items-center justify-center font-medium rounded-md border',
          'transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed',
          variantClasses[variant],
          sizeClasses[size],
          className,
        ].join(' ')}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
