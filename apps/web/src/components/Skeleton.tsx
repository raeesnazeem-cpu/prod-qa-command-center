import React from 'react';

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  circle?: boolean;
}

export const Skeleton: React.FC<SkeletonProps> = ({ 
  className = '', 
  width, 
  height, 
  circle = false 
}) => {
  const style: React.CSSProperties = {
    width: width,
    height: height,
    borderRadius: circle ? '50%' : undefined,
  };

  return (
    <div 
      className={`skeleton-base ${className}`} 
      style={style}
      aria-hidden="true"
    />
  );
};
