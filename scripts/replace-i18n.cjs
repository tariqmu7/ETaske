const fs = require('fs');
const path = require('path');

const correspPath = path.join(__dirname, '..', 'src', 'CorrespondingsDashboard.tsx');
const tasksPath = path.join(__dirname, '..', 'src', 'TasksDashboard.tsx');

let correspContent = fs.readFileSync(correspPath, 'utf8');
let tasksContent = fs.readFileSync(tasksPath, 'utf8');

// Ensure useTranslation is imported
if (!correspContent.includes('useTranslation')) {
    correspContent = correspContent.replace(
        "import React, { useState, useEffect, useMemo } from 'react';",
        "import React, { useState, useEffect, useMemo } from 'react';\nimport { useTranslation } from 'react-i18next';"
    );
    correspContent = correspContent.replace(
        "export default function CorrespondingsDashboard({ user, appUser, projectUsers, onNavigate }: Props) {",
        "export default function CorrespondingsDashboard({ user, appUser, projectUsers, onNavigate }: Props) {\n  const { t } = useTranslation();"
    );
}

if (!tasksContent.includes('useTranslation')) {
    tasksContent = tasksContent.replace(
        "import React, { useState, useEffect, useMemo } from 'react';",
        "import React, { useState, useEffect, useMemo } from 'react';\nimport { useTranslation } from 'react-i18next';"
    );
    tasksContent = tasksContent.replace(
        "export default function TasksDashboard({ user, appUser, projectUsers }: Props) {",
        "export default function TasksDashboard({ user, appUser, projectUsers }: Props) {\n  const { t } = useTranslation();"
    );
}

const cReplacements = [
    { target: `<option value="All">All Statuses</option>`, replacement: `<option value="All">{t('All Statuses')}</option>` },
    { target: `<option value="All">All Departments</option>`, replacement: `<option value="All">{t('All Departments')}</option>` },
    { target: `>OVERDUE</span>`, replacement: `>{t('OVERDUE')}</span>` },
    { target: `>DUE SOON</span>`, replacement: `>{t('DUE SOON')}</span>` },
    { target: `>No correspondences found</p>`, replacement: `>{t('No correspondences found')}</p>` },
    { target: `>No items match your filters, or nothing has been logged yet.<br />`, replacement: `>{t('No items match your filters')}<br />` },
    { target: `From: {item.sentFrom}`, replacement: `{t('From:')} {item.sentFrom}` },
    { target: `>Subject</label>`, replacement: `>{t('Subject')}</label>` },
    { target: `>Body / Description</label>`, replacement: `>{t('Body / Description')}</label>` },
    { target: `>Sent From</label>`, replacement: `>{t('Sent From')}</label>` },
    { target: `>Category</label>`, replacement: `>{t('Category')}</label>` },
    { target: `>Priority</label>`, replacement: `>{t('Priority')}</label>` },
    { target: `>Classification</div>`, replacement: `>{t('Classification')}</div>` },
    { target: `>Department</label>`, replacement: `>{t('Department')}</label>` },
    { target: `>Sub-Category / Project</label>`, replacement: `>{t('Sub-Category / Project')}</label>` },
    { target: `>Actions</label>`, replacement: `>{t('Actions')}</label>` },
    { target: `>Workflow</div>`, replacement: `>{t('Workflow')}</div>` },
    { target: `>Date Received</label>`, replacement: `>{t('Date Received')}</label>` },
    { target: `>Deadline</label>`, replacement: `>{t('Deadline')}</label>` },
    { target: `>Status</label>`, replacement: `>{t('Status')}</label>` },
    { target: `>Assignee</label>`, replacement: `>{t('Assignee')}</label>` },
    { target: `>Files & Notes</div>`, replacement: `>{t('Files')} & Notes</div>` },
    { target: `>Shared Folder Paths (Computer/Local)</label>`, replacement: `>{t('Shared Folder Paths (Computer/Local)')}</label>` },
    { target: `>No folder paths added.</p>`, replacement: `>{t('No folder paths added.')}</p>` },
    { target: `>Attachment</label>`, replacement: `>{t('Attachment')}</label>` },
    { target: `>Click to view or download</div>`, replacement: `>{t('Click to view or download')}</div>` },
    { target: `>No attachment</div>`, replacement: `>{t('No attachment')}</div>` },
    { target: `>Manager Notes / Internal Comments</label>`, replacement: `>{t('Manager Notes / Internal Comments')}</label>` },
    { target: `>Close</button>`, replacement: `>{t('Close')}</button>` },
    { target: `>Cancel</button>`, replacement: `>{t('Cancel')}</button>` },
    { target: `>Delete Corresponding?</h3>`, replacement: `>{t('Delete Corresponding?')}</h3>` },
    { target: `>Delete</button>`, replacement: `>{t('Delete')}</button>` },
    { target: `>Correspondence Body</h3>`, replacement: `>{t('Correspondence Body')}</h3>` },
    { target: `>No content provided.</span>`, replacement: `>{t('No content provided.')}</span>` },
    { target: `>Sent From</span>`, replacement: `>{t('Sent From')}</span>` },
    { target: `>Dates</span>`, replacement: `>{t('Dates')}</span>` },
    { target: `>Assignment</span>`, replacement: `>{t('Assignment')}</span>` },
    { target: `>Shared Folders / Links</h3>`, replacement: `>{t('Shared Folders / Links')}</h3>` },
    { target: `>Attachment</h3>`, replacement: `>{t('Attachment')}</h3>` },
    { target: `Click to open in new tab</div>`, replacement: `{t('Click to open in new tab')}</div>` }
];

for (const { target, replacement } of cReplacements) {
    correspContent = correspContent.split(target).join(replacement);
}
fs.writeFileSync(correspPath, correspContent, 'utf8');

const tReplacements = [
    { target: `>\n            Tasks\n          </h1>`, replacement: `>\n            {t('Tasks')}\n          </h1>` },
    { target: `>\n            Track your assigned tasks, organize your work, and add milestones to show progress.\n          </p>`, replacement: `>\n            {t('Track your assigned tasks')}\n          </p>` },
    { target: `>\n            Clear Date\n          </button>`, replacement: `>\n            {t('Clear Date')}\n          </button>` },
    { target: `<option value="All">All Statuses</option>`, replacement: `<option value="All">{t('All Statuses')}</option>` },
    { target: `<option value="All">All Departments</option>`, replacement: `<option value="All">{t('All Departments')}</option>` },
    { target: `<option value="All">All Employees</option>`, replacement: `<option value="All">{t('All Employees')}</option>` },
    { target: `Tag: {subCategoryFilter}`, replacement: `{t('Tag:')} {subCategoryFilter}` },
    { target: `>New Task</div>`, replacement: `>{t('New Task')}</div>` },
    { target: `>Fill in the details below</div>`, replacement: `>{t('Fill in the details below')}</div>` },
    { target: `>\n                    Task Name <span`, replacement: `>\n                    {t('Task Name')} <span` },
    { target: `>Description <span`, replacement: `>{t('Description')} <span` },
    { target: `>When <span`, replacement: `>{t('When')} <span` },
    { target: `>Priority</label>`, replacement: `>{t('Priority')}</label>` },
    { target: `>Due Date <span`, replacement: `>{t('Due Date')} <span` },
    { target: `>Who</label>`, replacement: `>{t('Who')}</label>` },
    { target: `>Assignee</label>`, replacement: `>{t('Assignee')}</label>` },
    { target: `>Classification</div>`, replacement: `>{t('Classification')}</div>` },
    { target: `>Category</label>`, replacement: `>{t('Category')}</label>` },
    { target: `>Department</label>`, replacement: `>{t('Department')}</label>` },
    { target: `>Sub-Category / Project</label>`, replacement: `>{t('Sub-Category / Project')}</label>` },
    { target: `>Attachment</label>`, replacement: `>{t('Attachment')}</label>` },
    { target: `>{isUploading ? 'Uploading to Drive…' : 'Click to attach a file'}</span>`, replacement: `>{isUploading ? t('Uploading to Drive...') : 'Click to attach a file'}</span>` },
    { target: `>Drop file or click to upload</span>`, replacement: `>{t('Drop file or click to upload')}</span>` },
    { target: `>Uploads to Google Drive</span>`, replacement: `>{t('Uploads to Google Drive')}</span>` },
    { target: `>Shared Folder Paths (Computer Paths)</label>`, replacement: `>{t('Shared Folder Paths (Computer Paths)')}</label>` },
    { target: `>Cancel</button>`, replacement: `>{t('Cancel')}</button>` },
    { target: `>OVERDUE</span>`, replacement: `>{t('OVERDUE')}</span>` },
    { target: `>DUE SOON</span>`, replacement: `>{t('DUE SOON')}</span>` },
    { target: `>Click to view or download</div>`, replacement: `>{t('Click to view or download')}</div>` },
    { target: `>Shared Folder Paths</h3>`, replacement: `>{t('Shared Folder Paths')}</h3>` },
    { target: `>\n                                            Open / Copy\n                                          </button>`, replacement: `>\n                                            {t('Open / Copy')}\n                                          </button>` },
    { target: `>No milestones yet. Add one to track progress.</p>`, replacement: `>{t('No milestones yet')}</p>` },
    { target: `By {selectedTaskForDetails.assignedBy}`, replacement: `{t('By')} {selectedTaskForDetails.assignedBy}` },
    { target: `>\n            Next <ChevronRight`, replacement: `>\n            {t('Next')} <ChevronRight` },
    { target: `>No tasks found</p>`, replacement: `>{t('No tasks found')}</p>` },
    { target: `>No tasks match your current filters.</p>`, replacement: `>{t('No tasks match your current filters.')}</p>` },
    { target: `>Clear All Filters</button>`, replacement: `>{t('Clear All Filters')}</button>` },
    { target: `>Edit Task</div>`, replacement: `>{t('Edit Task')}</div>` },
    { target: `>\n                  Save Changes\n                </button>`, replacement: `>\n                  {t('Save Changes')}\n                </button>` },
    { target: `>Update the due date?</h3>`, replacement: `>{t('Update the due date?')}</h3>` },
    { target: `>New due date</label>`, replacement: `>{t('New due date')}</label>` },
    { target: `>\n                    Keep current due date\n                  </span>`, replacement: `>\n                    {t('Keep current due date')}\n                  </span>` }
];

for (const { target, replacement } of tReplacements) {
    tasksContent = tasksContent.split(target).join(replacement);
}
fs.writeFileSync(tasksPath, tasksContent, 'utf8');

console.log('Replacement complete.');
