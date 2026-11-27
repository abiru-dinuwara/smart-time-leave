import ConfirmButton from '@/components/ConfirmButton'

/**
 * Comment box + Approve / Request changes / Reject, each confirmed in a dialog.
 * Rendered inside a <form> whose server action receives `decision` and `note`.
 */
export default function DecisionControls({ uid, what, who }: { uid: string; what: string; who: string }) {
  return (
    <>
      <div className="fld">
        <label htmlFor={`note-${uid}`}>Decision comment</label>
        <textarea id={`note-${uid}`} name="note" rows={2} maxLength={500} placeholder="Required when rejecting or requesting changes. The requester will see this." />
      </div>
      <div className="row decide-row">
        <ConfirmButton
          name="decision"
          value="approved"
          className="btn success"
          title={`Approve this ${what}?`}
          message={<p>{who} will be notified straight away. Decisions are recorded permanently in the approval history.</p>}
          confirmLabel="Approve"
        >
          Approve
        </ConfirmButton>
        <ConfirmButton
          name="decision"
          value="changes"
          className="btn"
          title="Request changes?"
          message={<p>The {what} goes back to {who} to correct and resubmit. Your comment is included.</p>}
          confirmLabel="Request changes"
          requireField="note"
          requireMessage="Add a comment explaining what needs to change."
        >
          Request changes
        </ConfirmButton>
        <ConfirmButton
          name="decision"
          value="rejected"
          className="btn danger"
          confirmClassName="btn danger-solid"
          title={`Reject this ${what}?`}
          message={<p>{who} will be notified with your comment. A rejected {what} cannot be reopened.</p>}
          confirmLabel="Reject"
          requireField="note"
          requireMessage="Add a comment explaining why you are rejecting it."
        >
          Reject
        </ConfirmButton>
      </div>
    </>
  )
}
