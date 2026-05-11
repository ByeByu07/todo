import styles from "./Navbar.module.css";

export default function Navbar() {
  return (
    <nav className={styles.navbar} aria-label="Main navigation">
      <div className={styles.spotlight} aria-hidden="true" />
      <span className={styles.title}>Symphony</span>
    </nav>
  );
}
