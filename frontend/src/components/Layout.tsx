import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { DatasetUpdatedNotice } from './DatasetUpdatedNotice';
import { ErrorBoundary } from './ErrorBoundary';
import styles from './Layout.module.css';

/** Primary navigation; each feature adds its entry when it exists. */
const NAV_ITEMS: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'Explorer', end: true },
];

/**
 * Application shell: skip link, header with navigation, main landmark and footer. After client-side
 * navigation, focus moves to <main> so keyboard and screen-reader users start at the new content
 * (the initial page load keeps the browser's default focus).
 */
export function Layout() {
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [pathname]);

  return (
    <>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link to="/" className={styles.brand}>
            EarlStock
          </Link>
          <nav aria-label="Main" className={styles.nav}>
            <ul>
              {NAV_ITEMS.map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} end={item.end ?? false}>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>
      <DatasetUpdatedNotice />
      <main id="main" ref={mainRef} tabIndex={-1} className={styles.main}>
        {/* Keyed by path: a crash on one page does not stick after navigating away. */}
        <ErrorBoundary key={pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          Historical daily prices as provided by the imported dataset. Not real-time data.
        </div>
      </footer>
    </>
  );
}
