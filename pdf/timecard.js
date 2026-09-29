import jsPDFModule from 'jspdf'
import autoTable from 'jspdf-autotable'
import { KSC_LOGO_DATA_URL } from '../ksc-logo-base64.js'

const JsPDF = jsPDFModule.jsPDF || jsPDFModule
const BROWN = [138, 93, 59]
const PINK = [255, 168, 189]
const PALE = [255, 240, 244]
const LINE = [235, 220, 211]
const CREAM = [255, 250, 245]

export function buildTimecardDoc(entry) {
  const doc = new JsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  const subject = entry.entry_type === 'Temp Timecard' ? entry.temp_worker_name_snapshot : entry.employee_name_snapshot
  const moneylessHours = [
    ['Regular Hours', Number(entry.regular_hours || 0).toFixed(2)],
    ['OT Hours', Number(entry.overtime_hours || 0).toFixed(2)],
    ['DT Hours', Number(entry.double_time_hours || 0).toFixed(2)],
    ['Total Hours', (Number(entry.regular_hours || 0) + Number(entry.overtime_hours || 0) + Number(entry.double_time_hours || 0)).toFixed(2)],
  ]
  doc.setFillColor(...CREAM)
  doc.rect(0, 0, width, height, 'F')
  doc.setFillColor(...PINK)
  doc.rect(0, 0, width, 9, 'F')
  doc.addImage(KSC_LOGO_DATA_URL, 'PNG', 42, 26, 190, 58, undefined, 'FAST')
  doc.setTextColor(...BROWN)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text(entry.entry_type === 'Temp Timecard' ? 'TEMP AGENCY TIMECARD' : 'EMPLOYEE OT SUBMISSION', width - 42, 48, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(entry.submission_number || 'Draft', width - 42, 66, { align: 'right' })
  doc.setDrawColor(...LINE)
  doc.line(42, 101, width - 42, 101)

  let y = 130
  const info = [
    ['Pay Period', entry.period_label || '—'],
    ['Department', entry.department_name_snapshot || '—'],
    ['Supervisor', entry.supervisor_name || '—'],
    ['Submitted By', entry.submitted_by_name || '—'],
    ['Submitted On Behalf Of', entry.submitted_on_behalf_of || 'Myself'],
    [entry.work_end_date && entry.work_end_date !== entry.work_date ? 'Work Dates' : 'Work Date', entry.work_end_date && entry.work_end_date !== entry.work_date ? `${entry.work_date || '—'} → ${entry.work_end_date}` : (entry.work_date || '—')],
  ]
  autoTable(doc, {
    startY: y,
    margin: { left: 42, right: 42 },
    tableWidth: width - 84,
    theme: 'grid',
    head: [['INTERNAL DETAILS', '']],
    body: info,
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 7, textColor: BROWN, lineColor: LINE },
    headStyles: { fillColor: BROWN, textColor: [255,255,255], fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 160, fontStyle: 'bold' }, 1: { cellWidth: width - 244 } },
  })
  y = (doc.lastAutoTable?.finalY || y + 80) + 24

  const workerRows = entry.entry_type === 'Temp Timecard'
    ? [['Temp Worker', subject || '—'], ['Temp Agency', entry.temp_agency_name_snapshot || '—'], ['Worker ID', entry.worker_id_snapshot || '—'], ['Assignment / Role', [entry.assignment_location, entry.job_role].filter(Boolean).join(' · ') || '—']]
    : [['Employee', subject || '—'], ['Employee ID', entry.employee_id || '—'], ['Assignment / Role', [entry.assignment_location, entry.job_role].filter(Boolean).join(' · ') || '—']]
  autoTable(doc, {
    startY: y,
    margin: { left: 42, right: 42 },
    tableWidth: width - 84,
    theme: 'grid',
    head: [['WORKER DETAILS', '']],
    body: workerRows,
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 7, textColor: BROWN, lineColor: LINE },
    headStyles: { fillColor: BROWN, textColor: [255,255,255], fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 160, fontStyle: 'bold' }, 1: { cellWidth: width - 244 } },
  })
  y = (doc.lastAutoTable?.finalY || y + 80) + 24

  if (Array.isArray(entry.work_days) && entry.work_days.length) {
    autoTable(doc, {
      startY: y,
      margin: { left: 42, right: 42 },
      tableWidth: width - 84,
      theme: 'grid',
      head: [['WORK DAYS', 'REGULAR', 'OT', 'DT']],
      body: entry.work_days.map(day => [day.date || '—', Number(day.regular_hours || 0).toFixed(2), Number(day.overtime_hours || 0).toFixed(2), Number(day.double_time_hours || 0).toFixed(2)]),
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 7, textColor: BROWN, lineColor: LINE },
      headStyles: { fillColor: BROWN, textColor: [255,255,255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: PALE },
      columnStyles: { 0: { cellWidth: 220, fontStyle: 'bold' }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    })
    y = (doc.lastAutoTable?.finalY || y + 60) + 24
  }

  autoTable(doc, {
    startY: y,
    margin: { left: 42, right: 42 },
    tableWidth: width - 84,
    theme: 'grid',
    head: [['HOURS', 'VALUE']],
    body: moneylessHours,
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 8, textColor: BROWN, lineColor: LINE },
    headStyles: { fillColor: PINK, textColor: BROWN, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: PALE },
    columnStyles: { 0: { cellWidth: 220, fontStyle: 'bold' }, 1: { halign: 'right' } },
  })
  y = (doc.lastAutoTable?.finalY || y + 100) + 24

  doc.setFillColor(...PALE)
  doc.setDrawColor(...LINE)
  doc.roundedRect(42, y, width - 84, 70, 8, 8, 'FD')
  doc.setTextColor(...BROWN)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('NOTES', 56, y + 20)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(doc.splitTextToSize(entry.notes || entry.reason_for_ot || 'No notes added.', width - 112), 56, y + 38)
  y += 96

  autoTable(doc, {
    startY: y,
    margin: { left: 42, right: 42 },
    tableWidth: width - 84,
    theme: 'grid',
    head: [['APPROVAL', '']],
    body: [['Status', entry.status || 'Draft'], ['Approved By', entry.approved_by_name || '—'], ['Approval Date', entry.approved_at ? new Date(entry.approved_at).toLocaleString('en-US') : '—'], ['Comments', entry.rejection_comment || '—']],
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 7, textColor: BROWN, lineColor: LINE },
    headStyles: { fillColor: BROWN, textColor: [255,255,255], fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 160, fontStyle: 'bold' }, 1: { cellWidth: width - 244 } },
  })

  doc.setDrawColor(...LINE)
  doc.line(42, height - 42, width - 42, height - 42)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...BROWN)
  doc.text('Kawaii Slime Company  •  Internal payroll record', 42, height - 26)
  doc.text(`Generated ${new Date().toLocaleString('en-US')}`, width - 42, height - 26, { align: 'right' })
  return doc
}

function timecardFileName(entry, extension) {
  const subject = entry.entry_type === 'Temp Timecard' ? entry.temp_worker_name_snapshot : entry.employee_name_snapshot
  return `${entry.entry_type === 'Temp Timecard' ? 'Temp Timecard' : 'Employee OT'} - ${subject || entry.submission_number}.${extension}`
}

export function generateTimecardPdf(entry) {
  buildTimecardDoc(entry).save(timecardFileName(entry, 'pdf'))
}

export async function generateTimecardImage(entry) {
  const doc = buildTimecardDoc(entry)
  const data = new Uint8Array(doc.output('arraybuffer'))
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  const pdf = await pdfjs.getDocument({ data }).promise
  try {
    const pages = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 2 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
      pages.push(canvas)
    }
    const width = Math.max(...pages.map(page => page.width))
    const height = pages.reduce((sum, page) => sum + page.height, 0) + (pages.length - 1) * 12
    const output = document.createElement('canvas')
    output.width = width
    output.height = height
    const context = output.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    let offsetY = 0
    for (const page of pages) {
      context.drawImage(page, 0, offsetY)
      offsetY += page.height + 12
    }
    await new Promise(resolve => output.toBlob(blob => {
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = timecardFileName(entry, 'png')
      link.click()
      URL.revokeObjectURL(url)
      resolve()
    }, 'image/png'))
  } finally {
    await pdf.destroy()
  }
}
