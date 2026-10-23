import styles from './Skeleton.module.css';

export default function Skeleton({ w = '100%', h = 14, radius = 8, style }) {
  return <div className={styles.skel} style={{ width: w, height: h, borderRadius: radius, ...style }} />;
}
