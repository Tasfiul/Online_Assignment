import { useCallback, useEffect, useState } from 'react';
import { db, storage } from '../firebase';
import { 
  collection, 
  getDocs, 
  addDoc, 
  doc, 
  updateDoc, 
  deleteDoc,
  serverTimestamp,
  arrayUnion
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { 
  Plus, 
  BookOpen, 
  UploadCloud, 
  XCircle, 
  MessageSquare,
  FileText,
  Users
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { parseDescriptionLinks, validateFileType, formatDate } from '../utils/helpers';

export default function StudentDashboard({ onOpenChat }) {
  const { currentUser } = useAuth();
  
  // Data State
  const [groups, setGroups] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [allGroups, setAllGroups] = useState([]); // All groups for browse / join
  
  // Selection
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  
  // Interactive UI
  const [passcode, setPasscode] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joinSuccess, setJoinSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const loadStudentData = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      // 1. Fetch All Groups (for passcode look-ups)
      const allGroupsSnap = await getDocs(collection(db, 'groups'));
      const allGroupsList = [];
      allGroupsSnap.forEach(d => {
        allGroupsList.push({ groupId: d.id, ...d.data() });
      });
      setAllGroups(allGroupsList);

      // Filter groups where student is enrolled
      const enrolled = allGroupsList.filter(g => g.members && g.members.includes(currentUser.uid));
      setGroups(enrolled);

      // 2. Fetch Assignments
      const assignmentsList = [];
      const assignSnap = await getDocs(collection(db, 'assignments'));
      assignSnap.forEach(d => {
        assignmentsList.push({ assignmentId: d.id, ...d.data() });
      });
      setAssignments(assignmentsList);

      // 3. Fetch Submissions (for student)
      const subSnap = await getDocs(collection(db, 'submissions'));
      const submissionsList = [];
      subSnap.forEach(d => {
        submissionsList.push({ submissionId: d.id, ...d.data() });
      });
      setSubmissions(submissionsList);

    } catch (error) {
      console.error("Error loading student assets:", error);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    loadStudentData();
  }, [loadStudentData]);

  // Passcode Joining Pipeline
  const handleJoinGroup = async (e) => {
    e.preventDefault();
    if (!passcode) return;
    setJoinError('');
    setJoinSuccess('');

    // Find group by passcode
    const targetGroup = allGroups.find(g => g.passcode.trim() === passcode.trim());

    if (!targetGroup) {
      setJoinError("Invalid classroom entry passcode.");
      return;
    }

    // Check if banned
    if (targetGroup.bannedUsers && targetGroup.bannedUsers.includes(currentUser.uid)) {
      setJoinError("Access denied. You have been banned from this group.");
      return;
    }

    // Check if already in group
    if (targetGroup.members && targetGroup.members.includes(currentUser.uid)) {
      setJoinSuccess("You are already enrolled in this class.");
      return;
    }

    const groupRef = doc(db, 'groups', targetGroup.groupId);

    try {
      if (targetGroup.isPublic) {
        // Public -> Instant members join
        await updateDoc(groupRef, {
          members: arrayUnion(currentUser.uid)
        });
        setJoinSuccess(`Enrolled successfully in "${targetGroup.name}"!`);
      } else {
        // Private -> Added to pendingApprovals
        if (targetGroup.pendingApprovals && targetGroup.pendingApprovals.includes(currentUser.uid)) {
          setJoinSuccess("Entry request is already pending teacher review.");
          return;
        }
        await updateDoc(groupRef, {
          pendingApprovals: arrayUnion(currentUser.uid)
        });
        setJoinSuccess(`Entry request submitted for "${targetGroup.name}". Awaiting teacher approval.`);
      }
      
      setPasscode('');
      await loadStudentData();
    } catch (err) {
      console.error(err);
      setJoinError("Failed to update classroom enrollment.");
    }
  };

  // Upload Pipeline
  const handleFileUpload = async (file) => {
    if (!selectedAssignment || uploadLoading) return;

    // Validate size (Strict 6MB Cap)
    const fileLimit = 6 * 1024 * 1024; // 6MB
    if (file.size > fileLimit) {
      alert(`File size (${(file.size / (1024 * 1024)).toFixed(2)}MB) exceeds the 6MB system boundary.`);
      return;
    }

    // Validate extension
    const isAllowed = validateFileType(file.name, selectedAssignment.allowedTypes);
    if (!isAllowed) {
      alert("Selected file format is not permitted for this assignment.");
      return;
    }

    setUploadLoading(true);

    try {
      // 1. Stream file directly to Cloud Storage
      const filePath = `groups/${selectedAssignment.groupId}/assignments/${selectedAssignment.assignmentId}/${currentUser.uid}_file`;
      const fileRef = ref(storage, filePath);
      
      const uploadResult = await uploadBytes(fileRef, file);
      const downloadUrl = await getDownloadURL(uploadResult.ref);

      // 2. Write metadata document to submissions ledger
      const submissionDoc = {
        assignmentId: selectedAssignment.assignmentId,
        groupId: selectedAssignment.groupId,
        studentId: currentUser.uid,
        studentName: currentUser.displayName || 'Anonymous Student',
        fileUrl: downloadUrl,
        fileName: file.name,
        submittedAt: serverTimestamp()
      };

      await addDoc(collection(db, 'submissions'), submissionDoc);
      await loadStudentData();
      
      // Update selected assignment state
      alert("Assignment submitted successfully!");
    } catch (err) {
      console.error("Upload failed:", err);
      alert(`File upload failed: ${err.message}`);
    } finally {
      setUploadLoading(false);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0]);
    }
  };

  // Rescind Submissions Routine (Allowed only before dueDate)
  const handleRescind = async (submission) => {
    const dueTime = selectedAssignment.dueDate?.toDate 
      ? selectedAssignment.dueDate.toDate() 
      : new Date(selectedAssignment.dueDate);
      
    if (new Date() > dueTime) {
      alert("Submission cannot be rescinded. The assignment deadline has passed.");
      return;
    }

    const confirmRescind = window.confirm("Are you sure you want to RESCIND this submission? This will delete the file from the cloud and reset your task status.");
    if (!confirmRescind) return;

    setUploadLoading(true);

    try {
      // 1. Wipe file from Cloud Storage
      const filePath = `groups/${selectedAssignment.groupId}/assignments/${selectedAssignment.assignmentId}/${currentUser.uid}_file`;
      const fileRef = ref(storage, filePath);
      
      try {
        await deleteObject(fileRef);
      } catch (storageErr) {
        console.warn("Storage deletion error (file may already be deleted):", storageErr);
      }

      // 2. Delete Firestore tracking record
      await deleteDoc(doc(db, 'submissions', submission.submissionId));
      
      await loadStudentData();
      alert("Submission rescinded.");
    } catch (err) {
      console.error("Rescind failed:", err);
      alert("Failed to rescind submission.");
    } finally {
      setUploadLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="empty-state">
        <div className="stat-icon" style={{ animation: 'spin 1.5s linear infinite' }}><BookOpen size={28} /></div>
        <p>Syncing class enrollment matrices and fetching active deadlines...</p>
      </div>
    );
  }

  // Filter assignments for groups student belongs to
  const enrolledGroupIds = groups.map(g => g.groupId);
  const activeAssignments = assignments.filter(a => enrolledGroupIds.includes(a.groupId));

  return (
    <div className="animate-fade-in">
      <div className="dashboard-header">
        <h1 className="dashboard-title">Student Hub</h1>
        <p className="dashboard-subtitle">Enroll in classroom groups, complete homework assignments, and review grades.</p>
      </div>

      <div className="grid-columns-2">
        {/* Left column: Browse & Join + Class list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Enroll in Class */}
          <div className="glass section-card">
            <h2 className="section-title">
              <Plus size={20} />
              <span>Enroll in Classroom</span>
            </h2>
            <form onSubmit={handleJoinGroup}>
              <div className="form-group">
                <label className="form-label">Class Passcode</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={passcode} 
                  onChange={(e) => setPasscode(e.target.value)} 
                  placeholder="Enter classroom entry passcode..." 
                  required 
                />
              </div>
              {joinError && <div className="badge badge-danger" style={{ display: 'block', padding: '8px', marginBottom: '16px' }}>{joinError}</div>}
              {joinSuccess && <div className="badge badge-success" style={{ display: 'block', padding: '8px', marginBottom: '16px' }}>{joinSuccess}</div>}
              
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                <span>Submit Passcode</span>
              </button>
            </form>
          </div>

          {/* Enrolled Classrooms */}
          <div className="glass section-card">
            <h2 className="section-title">
              <Users size={20} />
              <span>My Enrolled Classrooms</span>
            </h2>
            {groups.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>You aren't enrolled in any classrooms yet. Enter a passcode above to join.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {groups.map(g => (
                  <div 
                    key={g.groupId} 
                    className={`glass glass-interactive ${selectedGroup?.groupId === g.groupId ? 'active' : ''}`}
                    style={{ 
                      padding: '16px', 
                      cursor: 'pointer',
                      borderColor: selectedGroup?.groupId === g.groupId ? 'var(--primary)' : 'var(--border-color)'
                    }}
                    onClick={() => setSelectedGroup(g)}
                  >
                    <span style={{ fontWeight: 700, fontSize: '15px' }}>{g.name}</span>
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>{g.description || 'No description'}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column: Assignments list + Homework Detail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Active Homework List */}
          <div className="glass section-card">
            <h2 className="section-title">
              <BookOpen size={20} />
              <span>Homework Tasks</span>
            </h2>
            {activeAssignments.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>No active assignments available.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {activeAssignments.map(a => {
                  const hasSubmitted = submissions.some(
                    s => s.assignmentId === a.assignmentId && s.studentId === currentUser.uid
                  );
                  return (
                    <div 
                      key={a.assignmentId} 
                      className={`glass glass-interactive ${selectedAssignment?.assignmentId === a.assignmentId ? 'active' : ''}`}
                      style={{ 
                        padding: '16px', 
                        cursor: 'pointer',
                        borderColor: selectedAssignment?.assignmentId === a.assignmentId ? 'var(--primary)' : 'var(--border-color)'
                      }}
                      onClick={() => setSelectedAssignment(a)}
                    >
                      <div className="flex-between">
                        <span style={{ fontWeight: 700 }}>{a.name}</span>
                        <span className={`badge ${hasSubmitted ? 'badge-success' : 'badge-pending'}`}>
                          {hasSubmitted ? 'Submitted' : 'Pending'}
                        </span>
                      </div>
                      <div className="flex-between" style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                        <span>Due: {formatDate(a.dueDate)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Selected Assignment Detail & Submissions Area */}
          {selectedAssignment && (
            <div className="glass section-card animate-fade-in">
              <div className="flex-between" style={{ marginBottom: '12px' }}>
                <h3 style={{ fontSize: '18px', margin: 0 }}>{selectedAssignment.name}</h3>
                <button 
                  className="btn btn-secondary" 
                  onClick={() => onOpenChat(selectedAssignment)}
                >
                  <MessageSquare size={14} />
                  <span>Discussion Chat</span>
                </button>
              </div>

              <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px', lineHeight: '1.5' }}>
                {parseDescriptionLinks(selectedAssignment.description)}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', fontSize: '13px', marginBottom: '24px' }}>
                <div>
                  <strong>Start:</strong> {formatDate(selectedAssignment.startDate)}
                </div>
                <div>
                  <strong>Due:</strong> {formatDate(selectedAssignment.dueDate)}
                </div>
              </div>

              {/* Upload Panel */}
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
                <h4 style={{ fontSize: '14px', marginBottom: '12px' }}>Your Submission</h4>
                
                {(() => {
                  const studentSubmission = submissions.find(
                    s => s.assignmentId === selectedAssignment.assignmentId && s.studentId === currentUser.uid
                  );

                  if (studentSubmission) {
                    return (
                      <div className="glass" style={{ padding: '16px', background: 'rgba(16, 185, 129, 0.04)' }}>
                        <div className="flex-between" style={{ marginBottom: '12px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                            <FileText size={18} className="text-success" />
                            <a 
                              href={studentSubmission.fileUrl} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="parsed-link"
                              style={{ fontWeight: 600 }}
                            >
                              {studentSubmission.fileName || 'View Uploaded file'}
                            </a>
                          </span>
                          <span className="badge badge-success">Delivered</span>
                        </div>
                        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                          Submitted on {formatDate(studentSubmission.submittedAt)}
                        </p>

                        <button 
                          className="btn btn-danger" 
                          style={{ width: '100%' }}
                          onClick={() => handleRescind(studentSubmission)}
                          disabled={uploadLoading}
                        >
                          <XCircle size={14} />
                          <span>Rescind Submission</span>
                        </button>
                      </div>
                    );
                  }

                  // Not submitted yet
                  return (
                    <div>
                      <div 
                        className={`dropzone ${dragActive ? 'active' : ''}`}
                        onDragEnter={handleDrag}
                        onDragOver={handleDrag}
                        onDragLeave={handleDrag}
                        onDrop={handleDrop}
                        onClick={() => document.getElementById('file-upload-input').click()}
                      >
                        <UploadCloud size={36} className="dropzone-icon" />
                        <div>
                          <p style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
                            {uploadLoading ? 'Uploading binary asset...' : 'Drag & drop file or click to browse'}
                          </p>
                          <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            Maximum size: 6MB. Allowed formats:
                            {selectedAssignment.allowedTypes.pdf && ' PDF'}
                            {selectedAssignment.allowedTypes.image && ' Image'}
                            {selectedAssignment.allowedTypes.video && ' Video'}
                            {selectedAssignment.allowedTypes.codeOrDoc && ' Code/Doc'}
                          </p>
                        </div>
                        <input 
                          id="file-upload-input"
                          type="file" 
                          style={{ display: 'none' }}
                          onChange={handleFileChange}
                          disabled={uploadLoading}
                        />
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Peer Submissions Sharing */}
              {selectedAssignment.shareVisibility && (
                <div style={{ marginTop: '24px', borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
                  <h4 style={{ fontSize: '14px', marginBottom: '12px' }}>Peer Submissions</h4>
                  {submissions.filter(s => s.assignmentId === selectedAssignment.assignmentId && s.studentId !== currentUser.uid).length === 0 ? (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No classmate submissions available.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {submissions
                        .filter(s => s.assignmentId === selectedAssignment.assignmentId && s.studentId !== currentUser.uid)
                        .map(sub => (
                          <div key={sub.submissionId} className="flex-between glass" style={{ padding: '10px 14px', fontSize: '13px' }}>
                            <span>{sub.studentName}</span>
                            <a 
                              href={sub.fileUrl} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="parsed-link"
                            >
                              {sub.fileName || 'View file'}
                            </a>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
