import { useState, type FormEvent, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { getMruList, getPathLastSegment, removeMru, type MruItem } from '../lib/mru';
import styles from './Home.module.css';

/** Editor URL for a tree path. */
export function editorUrl(treePath: string): string {
  return `/tree?${new URLSearchParams({ path: treePath }).toString()}`;
}

export default function Home() {
  const navigate = useNavigate();
  const [treePath, setTreePath] = useState('');
  const [items, setItems] = useState<MruItem[]>(() => getMruList());

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const path = treePath.trim();
    if (path) {
      navigate(editorUrl(path));
    }
  };

  const onRemove = (event: MouseEvent, path: string) => {
    event.preventDefault();
    event.stopPropagation();
    setItems(removeMru(path));
  };

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <form className={styles.form} onSubmit={onSubmit}>
          <input
            type="text"
            className={styles.input}
            value={treePath}
            onChange={(event) => setTreePath(event.target.value)}
            placeholder="Enter full tree path"
            aria-label="Tree path"
          />
          <button type="submit" className={styles.open}>
            Open
          </button>
        </form>
      </div>
      <div className={styles.body}>
        <ul className={styles.mru} aria-label="Recently used trees">
          {items.map((item) => (
            <li key={item.path} className={styles.mruItem}>
              <Link to={editorUrl(item.path)} className={styles.mruLink}>
                <div className={styles.mruName}>{getPathLastSegment(item.path)}</div>
                <div className={styles.mruPath}>{item.path}</div>
              </Link>
              <button
                type="button"
                className={styles.remove}
                aria-label={`Remove ${item.path} from the list`}
                title="Remove from list"
                onClick={(event) => onRemove(event, item.path)}
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
