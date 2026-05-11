import SpreadsheetEmbed from "./components/SpreadsheetEmbed";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1 className={styles.title}>Embedded Google Spreadsheet</h1>
        <p className={styles.description}>
          This page demonstrates embedding a Google Spreadsheet directly into
          the web application using an iframe.
        </p>
        <SpreadsheetEmbed
          src="https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/pubhtml?widget=true&headers=false"
          title="Google Spreadsheet Demo"
          height="600px"
        />
      </main>
      <footer className={styles.footer}>
        <span>Powered by Next.js</span>
      </footer>
    </div>
  );
}
