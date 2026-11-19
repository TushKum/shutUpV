import React from 'react';

interface SparklineProps {
  values: number[];
  positive?: boolean;
  width?: number;
  height?: number;
}

export const Sparkline: React.FC<SparklineProps> = ({
  values,
  positive = true,
  width = 88,
  height = 24,
}) => {
  if (!values || values.length < 2) {
    return <span className="inline-block w-20 h-6 bg-[#0C1110]" aria-hidden="true" />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 2;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (width - pad * 2) + pad;
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const strokeColor = positive ? '#00D68F' : '#FF5364';
  const fillColor = positive ? 'rgba(0, 214, 143, 0.12)' : 'rgba(255, 83, 100, 0.12)';
  const areaPoints = `${pad},${height} ${points.join(' ')} ${width - pad},${height}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible shrink-0"
      aria-hidden="true"
    >
      <polygon points={areaPoints} fill={fillColor} />
      <polyline
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points.join(' ')}
      />
    </svg>
  );
};
