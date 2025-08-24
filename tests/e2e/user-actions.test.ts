import { test, expect } from '@playwright/test';
import { ChatPage } from '../pages/chat';

test.describe('User Action Handling System', () => {
  let chatPage: ChatPage;

  test.beforeEach(async ({ page }) => {
    chatPage = new ChatPage(page);
    await chatPage.goto();
  });

  test('should display available user actions based on workflow state', async ({
    page,
  }) => {
    // Start a workflow to get into a state with available actions
    await chatPage.sendMessage('Create a web application with database');

    // Wait for the workflow to start and potentially ask for clarifications
    await page.waitForSelector('[data-testid="workflow-progress"]', {
      timeout: 30000,
    });

    // Request available actions
    await chatPage.sendMessage('What actions can I take right now?');

    // Wait for available actions to be displayed
    await page.waitForSelector('[data-testid="available-actions"]', {
      timeout: 15000,
    });

    // Verify actions are displayed
    const actionsPanel = page.locator('[data-testid="available-actions"]');
    await expect(actionsPanel).toBeVisible();

    // Check for common action types
    const actionButtons = page.locator('[data-testid="action-button"]');
    const actionCount = await actionButtons.count();
    expect(actionCount).toBeGreaterThan(0);

    // Verify action details are shown
    const firstAction = actionButtons.first();
    await expect(
      firstAction.locator('[data-testid="action-label"]'),
    ).toBeVisible();
    await expect(
      firstAction.locator('[data-testid="action-description"]'),
    ).toBeVisible();
  });

  test('should handle continue action to resume workflow', async ({ page }) => {
    // Start a workflow that will pause for clarifications
    await chatPage.sendMessage('Deploy a microservices architecture');

    // Wait for clarification requests
    await page.waitForSelector('[data-testid="clarification-request"]', {
      timeout: 30000,
    });

    // Answer the clarifications
    const clarificationInputs = page.locator(
      '[data-testid="clarification-answer"]',
    );
    const count = await clarificationInputs.count();

    for (let i = 0; i < Math.min(count, 2); i++) {
      const input = clarificationInputs.nth(i);
      await input.fill(`Answer ${i + 1}`);
    }

    // Submit answers
    const submitButtons = page.locator('[data-testid="submit-clarification"]');
    const submitCount = await submitButtons.count();
    for (let i = 0; i < Math.min(submitCount, 2); i++) {
      await submitButtons.nth(i).click();
      await page.waitForTimeout(1000);
    }

    // Execute continue action
    await chatPage.sendMessage('Continue the workflow');

    // Wait for action result
    await page.waitForSelector('[data-testid="action-result"]', {
      timeout: 15000,
    });

    // Verify workflow continued
    const actionResult = page.locator('[data-testid="action-result"]');
    await expect(actionResult).toContainText('success');
    await expect(actionResult).toContainText('continue');
  });

  test('should handle skip action for optional steps', async ({ page }) => {
    // Start a workflow with optional steps
    await chatPage.sendMessage(
      'Create a basic web application with optional monitoring',
    );

    // Wait for workflow to progress
    await page.waitForTimeout(5000);

    // Execute skip action
    await chatPage.sendMessage('Skip optional steps');

    // Wait for action result
    await page.waitForSelector('[data-testid="action-result"]', {
      timeout: 15000,
    });

    // Verify skip action was executed
    const actionResult = page.locator('[data-testid="action-result"]');
    await expect(actionResult).toContainText('skip');

    // Check for consequences information
    await expect(
      actionResult.locator('[data-testid="action-consequences"]'),
    ).toBeVisible();
  });

  test('should handle restart action with consequence warnings', async ({
    page,
  }) => {
    // Start a workflow and let it progress
    await chatPage.sendMessage('Set up a simple database');

    // Wait for some progress
    await page.waitForTimeout(5000);

    // Execute restart action
    await chatPage.sendMessage('Restart the current phase');

    // Wait for consequence analysis
    await page.waitForSelector('[data-testid="action-consequences"]', {
      timeout: 15000,
    });

    // Verify consequences are shown
    const consequences = page.locator('[data-testid="action-consequences"]');
    await expect(consequences).toBeVisible();
    await expect(consequences).toContainText('progress');

    // Confirm restart
    const confirmButton = page.locator('[data-testid="confirm-action"]');
    if (await confirmButton.isVisible()) {
      await confirmButton.click();
    }

    // Wait for restart result
    await page.waitForSelector('[data-testid="action-result"]', {
      timeout: 15000,
    });

    // Verify restart was executed
    const actionResult = page.locator('[data-testid="action-result"]');
    await expect(actionResult).toContainText('restart');
    await expect(actionResult).toContainText('success');
  });

  test('should provide contextual help based on current state', async ({
    page,
  }) => {
    // Start a workflow to establish context
    await chatPage.sendMessage('Create a serverless application');

    // Wait for workflow to start
    await page.waitForTimeout(3000);

    // Request help
    await chatPage.sendMessage('I need help with what to do next');

    // Wait for contextual help
    await page.waitForSelector('[data-testid="contextual-help"]', {
      timeout: 15000,
    });

    // Verify help content is contextual
    const helpContent = page.locator('[data-testid="contextual-help"]');
    await expect(helpContent).toBeVisible();

    // Check for help sections
    await expect(
      helpContent.locator('[data-testid="help-section"]'),
    ).toHaveCount({ min: 1 });

    // Check for quick actions
    await expect(
      helpContent.locator('[data-testid="quick-actions"]'),
    ).toBeVisible();

    // Verify context-specific content
    const helpText = await helpContent.textContent();
    expect(helpText).toContain('workflow'); // Should mention workflow context
  });

  test('should handle modify action to change settings', async ({ page }) => {
    // Start a workflow
    await chatPage.sendMessage('Deploy a web service');

    // Wait for workflow to start
    await page.waitForTimeout(3000);

    // Execute modify action
    await chatPage.sendMessage('I want to modify my workflow settings');

    // Wait for modification interface
    await page.waitForSelector('[data-testid="modification-interface"]', {
      timeout: 15000,
    });

    // Verify modification options are available
    const modInterface = page.locator('[data-testid="modification-interface"]');
    await expect(modInterface).toBeVisible();

    // Check for modifiable aspects
    const modifiableItems = page.locator('[data-testid="modifiable-item"]');
    const itemCount = await modifiableItems.count();
    expect(itemCount).toBeGreaterThan(0);

    // Verify preferences can be modified
    await expect(modInterface).toContainText('preferences');
  });

  test('should validate actions before execution', async ({ page }) => {
    // Start a workflow
    await chatPage.sendMessage('Create a simple API');

    // Wait for workflow to start
    await page.waitForTimeout(3000);

    // Try to execute an invalid action (skip when no optional steps)
    await chatPage.sendMessage('Skip all steps');

    // Wait for validation result
    await page.waitForSelector('[data-testid="action-validation"]', {
      timeout: 15000,
    });

    // Verify validation feedback
    const validation = page.locator('[data-testid="action-validation"]');
    await expect(validation).toBeVisible();

    // Should show validation issues
    await expect(
      validation.locator('[data-testid="validation-issues"]'),
    ).toBeVisible();
  });

  test('should show action consequences and risk levels', async ({ page }) => {
    // Start a workflow with some progress
    await chatPage.sendMessage('Set up a complex infrastructure');

    // Wait for workflow progress
    await page.waitForTimeout(5000);

    // Request a high-risk action
    await chatPage.sendMessage('Restart the entire workflow');

    // Wait for consequence analysis
    await page.waitForSelector('[data-testid="action-consequences"]', {
      timeout: 15000,
    });

    // Verify risk level is shown
    const consequences = page.locator('[data-testid="action-consequences"]');
    await expect(consequences).toBeVisible();

    // Check for risk indicators
    await expect(
      consequences.locator('[data-testid="risk-level"]'),
    ).toBeVisible();

    // Check for impact estimation
    await expect(
      consequences.locator('[data-testid="estimated-impact"]'),
    ).toBeVisible();
  });

  test('should provide undo information for reversible actions', async ({
    page,
  }) => {
    // Start a workflow
    await chatPage.sendMessage('Create a database setup');

    // Wait for workflow to start
    await page.waitForTimeout(3000);

    // Execute a reversible action
    await chatPage.sendMessage('Continue workflow');

    // Wait for action result
    await page.waitForSelector('[data-testid="action-result"]', {
      timeout: 15000,
    });

    // Check for undo information
    const actionResult = page.locator('[data-testid="action-result"]');
    const undoInfo = actionResult.locator('[data-testid="undo-info"]');

    if (await undoInfo.isVisible()) {
      await expect(undoInfo.locator('[data-testid="can-undo"]')).toBeVisible();
      await expect(
        undoInfo.locator('[data-testid="undo-instructions"]'),
      ).toBeVisible();
    }
  });

  test('should handle dry run mode for action preview', async ({ page }) => {
    // Start a workflow
    await chatPage.sendMessage('Deploy a web application');

    // Wait for workflow to start
    await page.waitForTimeout(3000);

    // Request dry run of an action
    await chatPage.sendMessage(
      'Show me what would happen if I skip optional steps',
    );

    // Wait for dry run result
    await page.waitForSelector('[data-testid="dry-run-result"]', {
      timeout: 15000,
    });

    // Verify dry run information
    const dryRunResult = page.locator('[data-testid="dry-run-result"]');
    await expect(dryRunResult).toBeVisible();
    await expect(dryRunResult).toContainText('would');

    // Check for preview information
    await expect(
      dryRunResult.locator('[data-testid="preview-steps"]'),
    ).toBeVisible();
  });
});
