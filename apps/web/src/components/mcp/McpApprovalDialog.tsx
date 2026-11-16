import { useTranslate } from '../../i18n/index.js'
import { resolveMcpApproval, useMcpApprovalRequest } from '../../services/mcp/approval.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import styles from './McpApprovalDialog.module.css'

const formatInput = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2) ?? ''
  } catch {
    return String(value)
  }
}

export const McpApprovalDialog = () => {
  const t = useTranslate()
  const request = useMcpApprovalRequest()
  if (!request) {
    return null
  }
  return (
    <Modal
      title={t('mcpToolApprovalTitle')}
      closable
      onClose={() => resolveMcpApproval(false)}
      footer={
        <>
          <Button variant="outlined" onClick={() => resolveMcpApproval(false)}>
            {t('mcpToolApprovalDeny')}
          </Button>
          <Button onClick={() => resolveMcpApproval(true)}>{t('mcpToolApprovalAllow')}</Button>
        </>
      }
    >
      <div className={styles.content}>
        <p className={styles.description}>
          {t('mcpToolApprovalDescription', {
            server: request.serverName,
            tool: request.toolName,
          })}
        </p>
        <div className={styles.label}>{t('mcpToolApprovalArguments')}</div>
        <pre className={styles.arguments}>{formatInput(request.input)}</pre>
      </div>
    </Modal>
  )
}
