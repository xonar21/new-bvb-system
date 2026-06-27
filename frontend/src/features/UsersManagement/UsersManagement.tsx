import { useState } from 'react'
import { useAuthStore } from '../../store/authStore'
import { useUsers, useCreateUser, useUpdateUser, useDeleteUser } from '../../hooks/useUsers'
import type { CreateUserRequest, UpdateUserRequest } from '../../hooks/useUsers'
import type { User } from '../../types/Load'

const modalBackdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  zIndex: 1000,
}

const modalBox: React.CSSProperties = {
  background: '#fff',
  borderRadius: '8px',
  padding: '24px',
  width: '420px',
  boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
}

const input: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: '4px',
  border: '1px solid #ccc',
  fontSize: '13px',
  boxSizing: 'border-box',
}

const select: React.CSSProperties = {
  ...input,
  background: '#fff',
}

const label: React.CSSProperties = {
  display: 'block',
  marginBottom: '4px',
  fontSize: '12px',
  color: '#555',
  fontWeight: 600,
}

const btnPrimary: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: '4px',
  border: 'none',
  background: '#4a90d9',
  color: '#fff',
  fontSize: '13px',
  cursor: 'pointer',
  fontWeight: 600,
}

const btnDanger: React.CSSProperties = {
  ...btnPrimary,
  background: '#d32f2f',
}

const btnSecondary: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: '4px',
  border: '1px solid #ccc',
  background: '#fff',
  color: '#555',
  fontSize: '13px',
  cursor: 'pointer',
}

const cellStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: '13px',
  borderBottom: '1px solid #eee',
  textAlign: 'left',
}

const headerCellStyle: React.CSSProperties = {
  ...cellStyle,
  fontWeight: 600,
  fontSize: '12px',
  color: '#666',
  borderBottom: '2px solid #ddd',
  textTransform: 'uppercase',
}

export function UsersManagement() {
  const { user: currentUser } = useAuthStore()
  const { data: users, isLoading } = useUsers()
  const createMutation = useCreateUser()
  const updateMutation = useUpdateUser()
  const deleteMutation = useDeleteUser()

  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const [form, setForm] = useState<CreateUserRequest>({
    email: '',
    password: '',
    name: '',
    role: 'editor',
  })

  const [editForm, setEditForm] = useState<UpdateUserRequest>({})

  const resetForm = () => {
    setForm({ email: '', password: '', name: '', role: 'editor' })
    setShowCreate(false)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await createMutation.mutateAsync(form)
      resetForm()
    } catch {
      // error handled by mutation
    }
  }

  const startEdit = (u: User) => {
    setEditingId(u.id)
    setEditForm({
      email: u.email,
      name: u.name,
      role: u.role,
      is_blocked: u.is_blocked,
    })
  }

  const handleUpdate = async (id: number) => {
    const data: UpdateUserRequest = {}
    if (editForm.email !== undefined) data.email = editForm.email
    if (editForm.name !== undefined) data.name = editForm.name
    if (editForm.role !== undefined) data.role = editForm.role
    if (editForm.is_blocked !== undefined) data.is_blocked = editForm.is_blocked
    if (editForm.password) data.password = editForm.password

    try {
      await updateMutation.mutateAsync({ id, data })
      setEditingId(null)
      setEditForm({})
    } catch {
      // error handled by mutation
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync(id)
      setDeletingId(null)
    } catch {
      // error handled by mutation
    }
  }

  if (isLoading) {
    return (
      <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif', fontSize: '14px', color: '#666' }}>
        Loading users...
      </div>
    )
  }

  return (
    <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>Users Management</h2>
        <button onClick={() => setShowCreate(true)} style={btnPrimary}>
          + Create User
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: '4px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          <thead>
            <tr>
              <th style={headerCellStyle}>ID</th>
              <th style={headerCellStyle}>Email</th>
              <th style={headerCellStyle}>Name</th>
              <th style={headerCellStyle}>Role</th>
              <th style={headerCellStyle}>Blocked</th>
              <th style={headerCellStyle}>Last Active</th>
              <th style={{ ...headerCellStyle, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users?.map((u) => (
              <tr key={u.id}>
                {editingId === u.id ? (
                  <>
                    <td style={cellStyle}>{u.id}</td>
                    <td style={cellStyle}>
                      <input
                        style={input}
                        value={editForm.email ?? ''}
                        onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                      />
                    </td>
                    <td style={cellStyle}>
                      <input
                        style={input}
                        value={editForm.name ?? ''}
                        onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                      />
                    </td>
                    <td style={cellStyle}>
                      <select
                        style={select}
                        value={editForm.role ?? 'viewer'}
                        onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}
                      >
                        <option value="admin">admin</option>
                        <option value="editor">editor</option>
                        <option value="viewer">viewer</option>
                        <option value="root">root</option>
                      </select>
                    </td>
                    <td style={cellStyle}>
                      <input
                        type="checkbox"
                        checked={editForm.is_blocked ?? false}
                        onChange={(e) => setEditForm((f) => ({ ...f, is_blocked: e.target.checked }))}
                      />
                    </td>
                    <td style={cellStyle}>{u.last_active_at ? new Date(u.last_active_at).toLocaleString() : '-'}</td>
                    <td style={{ ...cellStyle, textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginRight: '8px' }}>
                          <input
                            style={{ ...input, width: '140px', fontSize: '12px' }}
                            placeholder="New password (optional)"
                            type="password"
                            value={editForm.password ?? ''}
                            onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value || undefined }))}
                          />
                        </div>
                        <button onClick={() => handleUpdate(u.id)} style={btnPrimary} disabled={updateMutation.isPending}>
                          Save
                        </button>
                        <button onClick={() => { setEditingId(null); setEditForm({}) }} style={btnSecondary}>
                          Cancel
                        </button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={cellStyle}>{u.id}</td>
                    <td style={cellStyle}>{u.email}</td>
                    <td style={cellStyle}>{u.name}</td>
                    <td style={cellStyle}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '10px',
                          fontSize: '12px',
                          fontWeight: 600,
                          background: u.role === 'root' ? '#e3f2fd' : '#f5f5f5',
                          color: u.role === 'root' ? '#1565c0' : '#666',
                        }}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td style={cellStyle}>
                      {u.is_blocked ? (
                        <span style={{ color: '#d32f2f', fontWeight: 600 }}>Yes</span>
                      ) : (
                        <span style={{ color: '#4caf50' }}>No</span>
                      )}
                    </td>
                    <td style={cellStyle}>{u.last_active_at ? new Date(u.last_active_at).toLocaleString() : '-'}</td>
                    <td style={{ ...cellStyle, textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => startEdit(u)}
                          style={btnSecondary}
                        >
                          Edit
                        </button>
                        {currentUser?.id !== u.id && (
                          <button
                            onClick={() => setDeletingId(u.id)}
                            style={btnDanger}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div style={modalBackdrop} onClick={(e) => e.target === e.currentTarget && resetForm()}>
          <div style={modalBox}>
            <h3 style={{ margin: '0 0 16px', fontSize: '16px' }}>Create User</h3>
            <form onSubmit={handleCreate}>
              <div style={{ marginBottom: '12px' }}>
                <label style={label}>Email</label>
                <input
                  style={input}
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div style={{ marginBottom: '12px' }}>
                <label style={label}>Name</label>
                <input
                  style={input}
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div style={{ marginBottom: '12px' }}>
                <label style={label}>Password</label>
                <input
                  style={input}
                  type="password"
                  required
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                />
              </div>
              <div style={{ marginBottom: '20px' }}>
                <label style={label}>Role</label>
                <select
                  style={select}
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                >
                  <option value="admin">admin</option>
                  <option value="editor">editor</option>
                  <option value="viewer">viewer</option>
                  <option value="root">root</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button type="button" onClick={resetForm} style={btnSecondary}>Cancel</button>
                <button type="submit" style={btnPrimary} disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deletingId !== null && (
        <div style={modalBackdrop} onClick={(e) => e.target === e.currentTarget && setDeletingId(null)}>
          <div style={modalBox}>
            <h3 style={{ margin: '0 0 8px', fontSize: '16px' }}>Confirm Delete</h3>
            <p style={{ margin: '0 0 20px', fontSize: '13px', color: '#666' }}>
              Are you sure you want to delete this user? This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setDeletingId(null)} style={btnSecondary}>Cancel</button>
              <button onClick={() => handleDelete(deletingId)} style={btnDanger} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
