/**
 * The delete action: a `sidebar.workspaces.session.menu.item` row over one
 * injected behavior, plus the `shell.overlay` dialog that confirms the
 * permanent erase. Deletion is irreversible — the durable log is destroyed —
 * so the menu row always opens the confirmation; confirming asks the Host to
 * stop the Session's running work (the durable stop-and-archive the
 * retraction flow uses) and then erase it. The diagnostics for Host
 * rejections live in the injected callbacks, not here.
 */
import { useState } from 'react'
import { Button, IconTrashOutlineRegular, MenuItemButton, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  DeleteSessionInjected,
  SessionDeleteConfirmInjected, SessionDeleteConfirmProps, SessionDeleteConfirmRequest,
  SessionMenuItemProps,
} from '../contract/slots.ts'
import browserCss from '../rows/WorkspaceBrowser.module.css'

/**
 * Menu row (order 500): open the permanent-delete confirmation. Available for
 * archived rows too, so the sidebar offers one delete path for both states.
 * @param props - owner share, the delete share, and the menu open state.
 * @returns the row.
 */
export function DeleteSessionMenuItem({
  sessionId, useArchived, useMenuOpenState, deleteSession, t,
}: SessionMenuItemProps<DeleteSessionInjected>) {
  const [, setMenuOpen] = useMenuOpenState()
  const archived = useArchived(set => set.has(sessionId))
  return (
    <MenuItemButton
      icon={<IconTrashOutlineRegular size={14} />}
      danger
      onSelect={() => {
        setMenuOpen(false)
        deleteSession(sessionId, archived)
      }}
    >
      {t('menu.deleteSession')}
    </MenuItemButton>
  )
}

/**
 * The `shell.overlay` entry: nothing while no confirmation is pending,
 * otherwise one dialog per request (keyed by the Session). Confirming stops
 * any running work and erases the Session; cancelling leaves it in place.
 * @param props - the request hook, its settlement, the stop-and-erase hop, and the locale seat.
 * @returns the open dialog, or null.
 */
export function SessionDeleteConfirmDialog({
  useDeleteRequest, settleSessionDelete, stopAndDeleteSession, t,
}: SessionDeleteConfirmProps) {
  const request = useDeleteRequest(pending => pending)
  if (request === null) return null
  return (
    <DeleteConfirmForm
      key={request.sessionId}
      request={request}
      stopAndDeleteSession={stopAndDeleteSession}
      onSettle={settleSessionDelete}
      t={t}
    />
  )
}

/** One request's dialog: in-flight and error state die with it. */
function DeleteConfirmForm({ request, stopAndDeleteSession, onSettle, t }: {
  request: SessionDeleteConfirmRequest
  stopAndDeleteSession: SessionDeleteConfirmInjected['stopAndDeleteSession']
  onSettle: () => void
  t: SessionDeleteConfirmProps['t']
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = () => {
    if (deleting) return
    onSettle()
  }
  const confirm = () => {
    setDeleting(true)
    setError(null)
    stopAndDeleteSession(request.sessionId).then(() => {
      setDeleting(false)
      onSettle()
    }).catch((reason: unknown) => {
      setDeleting(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  return (
    <Modal
      open
      onClose={close}
      closeLabel={t('close')}
      title={t('delete.session.confirm.title')}
      description={t('delete.session.confirm.desc', { title: request.displayTitle })}
      footer={(
        <>
          <Button variant="outline" disabled={deleting} onClick={close}>{t('cancel')}</Button>
          <Button
            variant="outline"
            className={browserCss.deleteAction}
            disabled={deleting}
            onClick={confirm}
          >
            {t('delete.session.confirm.action')}
          </Button>
        </>
      )}
    >
      {request.running && (
        <div className={browserCss.deleteStatus} role="note">{t('delete.session.confirm.running')}</div>
      )}
      {deleting && <div className={browserCss.deleteStatus} role="status">{t('delete.session.confirm.pending')}</div>}
      {error !== null && <div className={browserCss.renameError} role="alert">{error}</div>}
    </Modal>
  )
}
