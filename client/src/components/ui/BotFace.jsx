import styles from './BotFace.module.css';

export default function BotFace({ size = 32, tone = 'brand' }) {
  return (
    <span
      className={`${styles.bot} ${tone === 'light' ? styles.light : ''}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
