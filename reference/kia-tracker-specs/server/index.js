require('dotenv').config();
const express = require('express');
const cors = require('cors');
const dealsRouter = require('./routes/deals');
const usersRouter = require('./routes/users');
const emailRouter = require('./routes/email');
const deliveryChecklistsRouter = require('./routes/deliveryChecklists');
const sourcedUnitsRouter = require('./routes/sourcedUnits');
const dispatchRouter = require('./routes/dispatch');
const uploadRouter = require('./routes/upload');
const reportsRouter = require('./routes/reports');
const salespeopleRouter = require('./routes/salespeople');
const contactsRouter = require('./routes/contacts');
const storesRouter = require('./routes/stores');
const activityEventsRouter = require('./routes/activityEvents');
const searchRouter = require('./routes/search');
const tasksRouter = require('./routes/tasks');
const notificationsRouter = require('./routes/notifications');
const bulkRouter = require('./routes/bulk');
const clawbackRouter = require('./routes/clawback');
const inventoryRouter = require('./routes/inventory');
const workOrdersRouter = require('./routes/workOrders');
const documentsRouter = require('./routes/documents');
const lendersRouter = require('./routes/lenders');
const wholesaleRouter = require('./routes/wholesale');
const automationRulesRouter = require('./routes/automationRules');
const workflowsRouter = require('./routes/workflows');
const suppliersRouter = require('./routes/suppliers');
const expensesRouter = require('./routes/expenses');
const leadsRouter = require('./routes/leads');
const leadActivitiesRouter = require('./routes/leadActivities');
const leadCommunicationsRouter = require('./routes/leadCommunications');
const leadTasksRouter = require('./routes/leadTasks');
const tagsRouter = require('./routes/tags');
const assignmentRulesRouter = require('./routes/assignmentRules');
const conversationsRouter = require('./routes/conversations');
const templatesRouter = require('./routes/templates');
const appointmentsRouter = require('./routes/appointments');
const duplicatesRouter = require('./routes/duplicates');
const lostReasonsRouter = require('./routes/lostReasons');
const winLossAnalyticsRouter = require('./routes/winLossAnalytics');
const sourceCostsRouter = require('./routes/sourceCosts');
const sourceRoiAnalyticsRouter = require('./routes/sourceRoiAnalytics');
const savedFiltersRouter = require('./routes/savedFilters');
const scoringRulesRouter = require('./routes/scoringRules');
const leadAppointmentsRouter = require('./routes/leadAppointments');
const scopeToStore = require('./middleware/scopeToStore');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/deals', dealsRouter);
app.use('/api/users', usersRouter);
app.use('/api/email', emailRouter);
app.use('/api/delivery-checklists', deliveryChecklistsRouter);
app.use('/api/sourced-units', sourcedUnitsRouter);
app.use('/api/dispatch', dispatchRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/salespeople', salespeopleRouter);
app.use('/api/contacts', contactsRouter);
app.use('/api/stores', storesRouter);
app.use('/api/activity-events', activityEventsRouter);
app.use('/api/search', searchRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/bulk', bulkRouter);
app.use('/api/clawback', clawbackRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/work-orders', workOrdersRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/lenders', lendersRouter);
app.use('/api/wholesale', wholesaleRouter);
app.use('/api/automation-rules', automationRulesRouter);
app.use('/api/workflows', workflowsRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/leads', leadsRouter);
app.use('/api/leads/:id/activities', leadActivitiesRouter);
app.use('/api/leads/:id/communications', leadCommunicationsRouter);
app.use('/api/leads/:id/tasks', leadTasksRouter);
app.use('/api/tags', tagsRouter);
app.use('/api/assignment-rules', assignmentRulesRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/appointments', appointmentsRouter);
app.use('/api/duplicates', duplicatesRouter);
app.use('/api/lost-reasons', lostReasonsRouter);
app.use('/api/analytics/win-loss', winLossAnalyticsRouter);
app.use('/api/source-costs', sourceCostsRouter);
app.use('/api/analytics/source-roi', sourceRoiAnalyticsRouter);
app.use('/api/saved-filters', savedFiltersRouter);
app.use('/api/scoring-rules', scoringRulesRouter);
app.use('/api/leads/:id/appointments', leadAppointmentsRouter);

// Apply store scoping middleware to all routes after this point
// Routes registered above can opt-in by using req.storeId
app.use(scopeToStore);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Only start listening when run directly (not when imported for testing)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
