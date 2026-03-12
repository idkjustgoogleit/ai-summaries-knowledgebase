import React from 'react';

/**
 * LoadingSpinner component
 * @param {string} size - 'sm' | 'md' | 'lg' | 'full'
 * @param {string} text - Optional text to display
 */
function LoadingSpinner({ size = 'md', text = null }) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
    full: 'w-16 h-16'
  };

  const containerClasses = size === 'full' 
    ? 'fixed inset-0 flex items-center justify-center bg-dark-bg bg-opacity-50'
    : 'flex items-center justify-center';

  return (
    <div className={containerClasses}>
      <div className="flex flex-col items-center">
        <div className={`${sizeClasses[size]} border-4 border-t-transparent border-accent rounded-full animate-spin`}></div>
        {text && <p className="mt-2 text-text-secondary text-sm">{text}</p>}
      </div>
    </div>
  );
}

export default LoadingSpinner;