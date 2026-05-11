import styles from "./Footer.module.css";

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <a
        href="https://github.com/ByeByu07/todo"
        target="_blank"
        rel="noopener noreferrer"
      >
        <span className={styles.icon}>🎼</span>
        <span>Powered by Symphony</span>
      </a>
    </footer>
  );
}
