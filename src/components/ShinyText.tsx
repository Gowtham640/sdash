import React from 'react';

interface ShinyTextProps {
  text: string;
  disabled?: boolean;
  speed?: number;
  className?: string;
  textColor?: string;
  glowColor?: string;
}

const ShinyText: React.FC<ShinyTextProps> = ({ 
  text, 
  disabled = false, 
  speed = 5, 
  className = '',
  textColor = '#b5b5b5a4',
  glowColor = '#ffffff'
}) => {
  const animationDuration = `${speed}s`;

  // Convert hex to rgba for the glow
  const hexToRgba = (hex: string, alpha: number = 0.8) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  return (
    <div
      className={`bg-clip-text inline-block ${disabled ? '' : 'animate-shine'} ${className}`}
      style={{
        color: textColor,
        backgroundImage: `linear-gradient(120deg, rgba(255, 255, 255, 0) 40%, ${hexToRgba(glowColor, 0.8)} 50%, rgba(255, 255, 255, 0) 60%)`,
        backgroundSize: '200% 100%',
        WebkitBackgroundClip: 'text',
        animationDuration: animationDuration
      }}
    >
      {text}
    </div>
  );
};

export default ShinyText;

// tailwind.config.js
// module.exports = {
//   theme: {
//     extend: {
//       keyframes: {
//         shine: {
//           '0%': { 'background-position': '100%' },
//           '100%': { 'background-position': '-100%' },
//         },
//       },
//       animation: {
//         shine: 'shine 5s linear infinite',
//       },
//     },
//   },
//   plugins: [],
// };
