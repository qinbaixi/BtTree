import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from './App';

describe('App', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    window.localStorage.clear();
  });
  afterEach(cleanup);

  it('renders the home page at /', () => {
    render(<App />);
    expect(screen.getByPlaceholderText('Enter full tree path')).toBeTruthy();
  });
});
