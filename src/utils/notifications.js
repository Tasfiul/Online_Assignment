/**
 * Compiles a list of client-side notifications based on user context and state.
 */
export function calculateNotifications({ role, userId, groups, assignments, submissions, chats }) {
  const alerts = [];
  const now = new Date();

  if (role === 'student') {
    // 1. Check assignments and deadlines
    assignments.forEach(assignment => {
      // Find the group for this assignment
      const group = groups.find(g => g.groupId === assignment.groupId);
      // Student must be a member of this group
      if (!group || !group.members || !group.members.includes(userId)) return;

      // Check if student already has a submission
      const hasSubmitted = submissions.some(
        sub => sub.assignmentId === assignment.assignmentId && sub.studentId === userId
      );

      const dueTime = assignment.dueDate?.toDate ? assignment.dueDate.toDate() : new Date(assignment.dueDate);
      const startTime = assignment.startDate?.toDate ? assignment.startDate.toDate() : new Date(assignment.startDate);

      if (!hasSubmitted) {
        const diffMs = dueTime - now;
        const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));

        if (diffMs > 0 && diffHours <= 48) {
          alerts.push({
            id: `due-soon-${assignment.assignmentId}`,
            title: 'Assignment Due Soon',
            description: `"${assignment.name}" is due in ${diffHours} hours!`,
            time: dueTime,
            type: 'warning'
          });
        } else if (diffMs < 0) {
          alerts.push({
            id: `overdue-${assignment.assignmentId}`,
            title: 'Assignment Overdue',
            description: `"${assignment.name}" is past due!`,
            time: dueTime,
            type: 'danger'
          });
        }
      }
    });

    // 2. Check for group approvals (if student is in members, but was previously pending - handled UI-side or via state check)
    groups.forEach(group => {
      if (group.members && group.members.includes(userId)) {
        // Let student know they are inside
        // (Just a notification that they are in the group)
        alerts.push({
          id: `group-joined-${group.groupId}`,
          title: 'Classroom Enrolled',
          description: `You are an active member of "${group.name}".`,
          time: group.createdAt?.toDate ? group.createdAt.toDate() : new Date(),
          type: 'success'
        });
      }
    });

  } else if (role === 'teacher') {
    // 1. Check for pending approvals in owned groups
    groups.forEach(group => {
      if (group.ownerId === userId && group.pendingApprovals && group.pendingApprovals.length > 0) {
        alerts.push({
          id: `pending-approvals-${group.groupId}`,
          title: 'Access Request',
          description: `${group.pendingApprovals.length} student(s) awaiting approval in "${group.name}".`,
          time: new Date(),
          type: 'info'
        });
      }
    });

    // 2. Check for reached assignment deadlines
    assignments.forEach(assignment => {
      const group = groups.find(g => g.groupId === assignment.groupId);
      if (!group || group.ownerId !== userId) return;

      const dueTime = assignment.dueDate?.toDate ? assignment.dueDate.toDate() : new Date(assignment.dueDate);
      if (dueTime < now) {
        // Count how many submissions we have
        const subCount = submissions.filter(sub => sub.assignmentId === assignment.assignmentId).length;
        alerts.push({
          id: `deadline-passed-${assignment.assignmentId}`,
          title: 'Deadline Reached',
          description: `Deadline passed for "${assignment.name}". Total submissions: ${subCount}.`,
          time: dueTime,
          type: 'info'
        });
      }
    });
  }

  // Sort alerts by time descending
  return alerts.sort((a, b) => b.time - a.time);
}
