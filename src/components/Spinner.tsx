import React from 'react';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'h-4 w-4 border-2',
  md: 'h-8 w-8 border-3',
  lg: 'h-12 w-12 border-4',
};

export const Spinner: React.FC<SpinnerProps> = ({ size = 'md', className = '' }) => {
  return (
    <div
      className={`animate-spin rounded-full border-blue-500 border-t-transparent ${sizeClasses[size]} ${className}`}
      role="status"
      aria-label="Loading"
    />
  );
};

export default Spinner;
