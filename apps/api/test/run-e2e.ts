import '../src/config/env';
import { run } from 'jest';

// Load local development settings before Jest supplies its default NODE_ENV=test.
// TEST_DATABASE_URL must still be explicitly set by the caller.
void run(['--runInBand', '--testPathPatterns=e2e']);
