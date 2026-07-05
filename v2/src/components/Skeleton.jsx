import s from './Skeleton.module.css';

export default function Skeleton({ width = '100%', height = 16, radius = 8, style = {} }) {
  return <div className={s.bone} style={{ width, height, borderRadius: radius, ...style }} />;
}

export function SkeletonEventCard() {
  return (
    <div className={s.card}>
      <Skeleton height={200} radius={12} style={{ marginBottom: 12 }} />
      <Skeleton width="60%" height={14} style={{ marginBottom: 8 }} />
      <Skeleton width="40%" height={12} />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className={s.row}>
      <Skeleton width={48} height={48} radius={8} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <Skeleton width="55%" height={14} style={{ marginBottom: 8 }} />
        <Skeleton width="35%" height={11} />
      </div>
    </div>
  );
}
