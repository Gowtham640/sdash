'use client';

import { useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingSpinner } from './ui/loading';

interface NavigationButtonProps {
  children: ReactNode;
  path: string;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  showLoader?: boolean;
}

export default function NavigationButton({
  children,
  path,
  className = '',
  onClick,
  disabled = false,
  showLoader = true,
}: NavigationButtonProps) {
  const router = useRouter();
  const [isNavigating, setIsNavigating] = useState(false);

  const handleClick = () => {
    if (disabled || isNavigating) return;

    if (onClick) {
      onClick();
    }

    if (showLoader) {
      setIsNavigating(true);
      // Small delay to show the loading state
      setTimeout(() => {
        router.push(path);
      }, 100);
    } else {
      router.push(path);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled || isNavigating}
      className={`relative ${className} ${disabled || isNavigating ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
    >
      {isNavigating && showLoader && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-inherit">
          <LoadingSpinner size="sm" className="text-white" />
        </span>
      )}
      <span className={isNavigating && showLoader ? 'opacity-50' : ''}>
        {children}
      </span>
    </button>
  );
}
