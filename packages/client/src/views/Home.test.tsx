import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MRU_STORAGE_KEY } from '../lib/mru';
import Home from './Home';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route
          path="/tree"
          element={
            <>
              <div>Editor page</div>
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Home', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(cleanup);

  it('navigates to the editor with the typed path', () => {
    renderHome();
    fireEvent.change(screen.getByPlaceholderText('Enter full tree path'), {
      target: { value: 'D:\\trees\\owl.json' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(screen.getByText('Editor page')).toBeTruthy();
    expect(screen.getByTestId('location').textContent).toBe('/tree?path=D%3A%5Ctrees%5Cowl.json');
  });

  it('does not navigate for an empty path', () => {
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.queryByText('Editor page')).toBeNull();
  });

  it('lists recently used trees and opens one by clicking it', () => {
    window.localStorage.setItem(
      MRU_STORAGE_KEY,
      JSON.stringify([{ path: '/a/first.json' }, { path: '/b/second.json' }]),
    );
    renderHome();

    expect(screen.getByText('first.json')).toBeTruthy();
    expect(screen.getByText('/b/second.json')).toBeTruthy();

    fireEvent.click(screen.getByText('second.json'));
    expect(screen.getByTestId('location').textContent).toBe('/tree?path=%2Fb%2Fsecond.json');
  });

  it('removes an item from the list and from storage', () => {
    window.localStorage.setItem(
      MRU_STORAGE_KEY,
      JSON.stringify([{ path: '/a/first.json' }, { path: '/b/second.json' }]),
    );
    renderHome();

    fireEvent.click(screen.getByRole('button', { name: 'Remove /a/first.json from the list' }));

    expect(screen.queryByText('first.json')).toBeNull();
    expect(window.localStorage.getItem(MRU_STORAGE_KEY)).toBe('[{"path":"/b/second.json"}]');
  });
});
