const supabase = require('./supabase');

/**
 * Log an activity event to the activity_events table.
 *
 * @param {object} params
 * @param {string} params.entityType - 'deal', 'contact', 'salesperson', etc.
 * @param {string} params.entityId - UUID of the entity
 * @param {string} params.action - 'created', 'updated', 'deleted', etc.
 * @param {string|null} params.actorId - UUID of the user who performed the action
 * @param {object|null} params.oldValue - Previous state (for updates)
 * @param {object|null} params.newValue - New state (for creates/updates)
 * @param {object|null} params.metadata - Extra context
 * @param {string|null} params.storeId - Store UUID
 */
async function logActivity({
  entityType,
  entityId,
  action,
  actorId = null,
  oldValue = null,
  newValue = null,
  metadata = null,
  storeId = null,
}) {
  try {
    await supabase.from('activity_events').insert({
      entity_type: entityType,
      entity_id: entityId,
      action,
      actor_id: actorId,
      old_value: oldValue,
      new_value: newValue,
      metadata,
      store_id: storeId,
    });
  } catch (err) {
    // Activity logging should never block the main operation
    console.error('Failed to log activity event:', err);
  }
}

module.exports = { logActivity };
