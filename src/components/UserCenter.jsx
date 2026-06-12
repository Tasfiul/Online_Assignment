import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

import { User, Image as ImageIcon, Trash2, CheckCircle, AlertTriangle, ShieldAlert } from 'lucide-react';

export default function UserCenter() {
  const { userProfile, currentUser, updateUserProfile, deleteAccount, authError, clearError } = useAuth();

  const [name, setName] = useState(userProfile?.name || '');
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setSuccessMsg('');
    try {
      await updateUserProfile(name, userProfile.photoURL);
      setSuccessMsg('Profile updated successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert("Please upload a valid image file.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      alert("Image size should be less than 2MB.");
      return;
    }

    setUploadingAvatar(true);
    setSuccessMsg('');
    try {
      const formData = new FormData();
      formData.append('file', file);

      const baseUrl = import.meta.env.VITE_API_URL?.replace('localhost', window.location.hostname) || `http://${window.location.hostname}:5000`;
      const response = await fetch(`${baseUrl}/api/upload`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('Network response was not ok');
      }

      const data = await response.json();

      await updateUserProfile(name, data.url);
      setSuccessMsg('Profile picture updated!');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      console.error("Avatar upload failed:", err);
      alert("Failed to upload avatar via custom backend.");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleDeleteAccount = async () => {
    const confirmed = window.confirm(
      "WARNING: Are you absolutely sure you want to delete your account? This action is permanent and will delete your profile."
    );
    if (!confirmed) return;

    try {
      await deleteAccount();
      // Auth observer will redirect to login page
    } catch (err) {
      console.error("Delete account error:", err);
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="dashboard-header">
        <h1 className="dashboard-title">User Center</h1>
        <p className="dashboard-subtitle">Manage your personal profile and system identity.</p>
      </div>

      {authError && (
        <div className="badge badge-danger" style={{ display: 'flex', gap: '8px', padding: '12px 16px', marginBottom: '24px', borderRadius: 'var(--radius-sm)' }}>
          <AlertTriangle size={16} />
          <span>{authError}</span>
          <button
            onClick={clearError}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#f87171', cursor: 'pointer' }}
          >
            &times;
          </button>
        </div>
      )}

      {successMsg && (
        <div className="badge badge-success" style={{ display: 'flex', gap: '8px', padding: '12px 16px', marginBottom: '24px', borderRadius: 'var(--radius-sm)' }}>
          <CheckCircle size={16} />
          <span>{successMsg}</span>
        </div>
      )}

      <div className="grid-columns-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px' }}>

        {/* Profile Editing Card */}
        <div className="glass section-card">
          <h2 className="section-title">
            <User size={20} />
            <span>Profile Identity</span>
          </h2>

          <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', marginBottom: '24px' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ position: 'relative', width: '80px', height: '80px', marginBottom: '12px' }}>
                <img
                  src={userProfile?.photoURL || 'https://via.placeholder.com/150'}
                  alt="Avatar"
                  style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--primary)' }}
                  onError={(e) => { e.target.src = 'https://api.dicebear.com/7.x/bottts/svg?seed=' + currentUser?.uid; }}
                />
                <button
                  className="btn btn-primary"
                  style={{ position: 'absolute', bottom: '-8px', right: '-8px', padding: '6px', borderRadius: '50%' }}
                  onClick={() => document.getElementById('avatar-upload').click()}
                  disabled={uploadingAvatar}
                  title="Upload new picture"
                >
                  <ImageIcon size={14} />
                </button>
                <input
                  type="file"
                  id="avatar-upload"
                  style={{ display: 'none' }}
                  accept="image/*"
                  onChange={handleFileChange}
                />
              </div>
              {uploadingAvatar && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Uploading...</div>}
            </div>

            <div style={{ flexGrow: 1 }}>
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label className="form-label">System Role</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span className={`badge ${userProfile?.role === 'admin' ? 'badge-danger' :
                      userProfile?.role === 'teacher' ? 'badge-success' : 'badge-info'
                    }`} style={{ fontSize: '14px', padding: '6px 12px' }}>
                    {userProfile?.role}
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Assigned by System Admin</span>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input
                  type="text"
                  className="form-input"
                  value={userProfile?.email || ''}
                  disabled
                  style={{ opacity: 0.7 }}
                />
              </div>
            </div>
          </div>

          <form onSubmit={handleUpdateProfile}>
            <div className="form-group">
              <label className="form-label">Display Name</label>
              <input
                type="text"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Saving...' : 'Save Profile Changes'}
            </button>
          </form>
        </div>

        {/* Danger Zone */}
        <div className="glass section-card" style={{ borderColor: 'rgba(239, 68, 68, 0.3)' }}>
          <h2 className="section-title" style={{ color: '#f87171', borderBottomColor: 'rgba(239, 68, 68, 0.2)' }}>
            <ShieldAlert size={20} />
            <span>Danger Zone</span>
          </h2>

          <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '24px', lineHeight: '1.5' }}>
            Permanently delete your account and profile from the system. This action cannot be undone.
            All of your submitted assignments and class enrollments will be wiped.
          </p>

          <button
            className="btn btn-danger"
            onClick={handleDeleteAccount}
            style={{ width: '100%', padding: '14px' }}
          >
            <Trash2 size={18} />
            <span>Permanently Delete Account</span>
          </button>
        </div>
      </div>
    </div>
  );
}
