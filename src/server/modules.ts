/**
 * Registers every gameplay module with the installer (import for side effects). Shared by the
 * integrated server worker and the dedicated Node server.
 */
import './survival/index';
import './commands/index';
import './commands/core';
import './mobs/index';
import './combat/index';
