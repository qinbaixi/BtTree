import { useEffect, useState } from 'react';
import { fetchSamples, openSample, type SampleInfo } from '../lib/api';
import { alerts } from '../store/alertStore';
import { t } from '../i18n';
import styles from './SamplesSection.module.css';

export const SAMPLES_SECTION_ID = 'samples';

/** Title and summary of the samples the app ships; other folders show their id. */
function describe(id: string): { title: string; summary: string; icon: string } {
  switch (id) {
    case 'basic':
      return {
        title: t('Basic project'),
        summary: t(
          'Node, decorator and service types with properties, a project plugin (owl-bt.js) and a custom CSV exporter.',
        ),
        icon: 'fa-cubes',
      };
    case 'simulation':
      return {
        title: t('Run mode and utility AI'),
        summary: t(
          'Trees to run in the simulator with scenarios: a guard, a sentry, and a utility AI fighter that scores its options.',
        ),
        icon: 'fa-play',
      };
    default:
      return { title: id, summary: '', icon: 'fa-folder' };
  }
}

/** Tree name without the folder and the .json extension. */
function treeName(relPath: string): string {
  return (relPath.split('/').pop() ?? relPath).replace(/\.json$/i, '');
}

/**
 * The samples built into the app. Opening one copies it to a writable folder in the user profile
 * (so edits never touch the bundled files) and opens the tree, or lists the copy as the workspace.
 */
export default function SamplesSection({
  onOpenTree,
  onBrowse,
}: {
  onOpenTree: (treePath: string) => void;
  onBrowse: (dir: string) => void;
}) {
  const [samples, setSamples] = useState<SampleInfo[] | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    fetchSamples().then(
      (list) => current && setSamples(list),
      () => current && setSamples([]),
    );
    return () => {
      current = false;
    };
  }, []);

  if (samples === undefined || samples.length === 0) {
    return null;
  }

  const open = async (id: string, relPath?: string): Promise<void> => {
    setBusy(`${id}/${relPath ?? ''}`);
    try {
      const opened = await openSample(id);
      const tree = relPath && opened.trees.find((item) => item.relPath === relPath);
      if (tree) {
        onOpenTree(tree.path);
      } else {
        onBrowse(opened.dir);
      }
    } catch (err) {
      alerts.error(
        t('Could not open the sample: {message}', {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <section id={SAMPLES_SECTION_ID} className={styles.section} aria-labelledby="samples-heading">
      <h2 id="samples-heading" className={styles.heading}>
        {t('Samples')}
      </h2>
      <div className={styles.grid}>
        {samples.map((sample) => {
          const info = describe(sample.id);
          return (
            <article key={sample.id} className={styles.card} aria-label={info.title}>
              <header className={styles.cardHead}>
                <i className={`fa-solid ${info.icon} ${styles.icon}`} aria-hidden="true" />
                <h3 className={styles.title}>{info.title}</h3>
                <button
                  type="button"
                  className={styles.browse}
                  onClick={() => void open(sample.id)}
                  disabled={busy !== null}
                  title={t('List the trees of this sample as the workspace')}
                >
                  <i className="fa-solid fa-folder-open" aria-hidden="true" /> {t('Browse')}
                </button>
              </header>
              {info.summary !== '' && <p className={styles.summary}>{info.summary}</p>}
              <ul className={styles.trees}>
                {sample.trees.map((relPath) => (
                  <li key={relPath}>
                    <button
                      type="button"
                      className={styles.tree}
                      onClick={() => void open(sample.id, relPath)}
                      disabled={busy !== null}
                      title={relPath}
                    >
                      <i className="fa-regular fa-file" aria-hidden="true" />
                      <span className={styles.treeName}>{treeName(relPath)}</span>
                      <span className={styles.treePath}>{relPath}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
      <p className={styles.hint}>
        {t(
          'Samples open as a copy in your user folder, so you can edit and run them freely. A copy is reset when an app update changes the sample.',
        )}
      </p>
    </section>
  );
}
