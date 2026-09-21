import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EditableTitle from './EditableTitle';

describe('EditableTitle', () => {
  it('renders a plain heading with no pencil when onRename is absent', () => {
    render(<EditableTitle title="Data Council" />);
    expect(screen.getByRole('heading', { name: 'Data Council' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
  });

  it('enters edit mode from the pencil and commits a changed name on Enter', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<EditableTitle title="Data Council" onRename={onRename} renameLabel="Rename group" />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename group' }));
    const input = screen.getByRole('textbox', { name: 'Rename group' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Data Governance Council' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('Data Governance Council'));
  });

  it('does not call onRename when the name is unchanged or blank', () => {
    const onRename = vi.fn();
    render(<EditableTitle title="Data Council" onRename={onRename} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByRole('textbox');
    // unchanged
    fireEvent.keyDown(input, { key: 'Enter' });
    // blank
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onRename).not.toHaveBeenCalled();
  });

  it('cancels on Escape without calling onRename', () => {
    const onRename = vi.fn();
    render(<EditableTitle title="Data Council" onRename={onRename} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Something else' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Data Council' })).toBeInTheDocument();
  });
});
