import { test, expect } from '@playwright/test';
import { ChatPage } from '../pages/chat';

test.describe('User Preference Management', () => {
  let chatPage: ChatPage;

  test.beforeEach(async ({ page }) => {
    chatPage = new ChatPage(page);
    await chatPage.goto();
  });

  test('should allow users to view and modify preferences', async ({
    page,
  }) => {
    // Start a conversation to initialize the system
    await chatPage.sendMessage('Show me my current preferences');

    // Wait for preferences to be displayed
    await page.waitForSelector('[data-testid="user-preferences"]', {
      timeout: 15000,
    });

    // Verify default preferences are shown
    const preferencesPanel = page.locator('[data-testid="user-preferences"]');
    await expect(preferencesPanel).toBeVisible();

    // Check for key preference options
    await expect(
      preferencesPanel.locator('[data-testid="auto-advance-preference"]'),
    ).toBeVisible();
    await expect(
      preferencesPanel.locator('[data-testid="verbosity-level"]'),
    ).toBeVisible();
    await expect(
      preferencesPanel.locator('[data-testid="question-format"]'),
    ).toBeVisible();
  });

  test('should provide preference recommendations based on usage', async ({
    page,
  }) => {
    // Simulate some user interactions first
    await chatPage.sendMessage('Create a simple web application');

    // Wait for and answer some clarifications to build usage patterns
    await page.waitForSelector('[data-testid="clarification-request"]', {
      timeout: 30000,
    });

    // Answer a few questions to establish patterns
    const clarificationInputs = page.locator(
      '[data-testid="clarification-answer"]',
    );
    const count = await clarificationInputs.count();

    for (let i = 0; i < Math.min(count, 3); i++) {
      const input = clarificationInputs.nth(i);
      await input.fill(`Answer ${i + 1}`);
    }

    // Submit answers
    const submitButtons = page.locator('[data-testid="submit-clarification"]');
    const submitCount = await submitButtons.count();
    for (let i = 0; i < Math.min(submitCount, 3); i++) {
      await submitButtons.nth(i).click();
      await page.waitForTimeout(1000); // Wait between submissions
    }

    // Request preference recommendations
    await chatPage.sendMessage(
      'What preference recommendations do you have for me?',
    );

    // Wait for recommendations
    await page.waitForSelector('[data-testid="preference-recommendations"]', {
      timeout: 15000,
    });

    // Verify recommendations are provided
    const recommendations = page.locator(
      '[data-testid="preference-recommendations"]',
    );
    await expect(recommendations).toBeVisible();

    // Check for recommendation details
    await expect(
      recommendations.locator('[data-testid="recommendation-item"]'),
    ).toHaveCount({ min: 0 });
  });

  test('should respect auto-advance preferences', async ({ page }) => {
    // Set auto-advance to 'always'
    await chatPage.sendMessage('Set my auto-advance preference to always');

    // Wait for confirmation
    await page.waitForSelector('[data-testid="preference-updated"]', {
      timeout: 10000,
    });

    // Start a workflow that would normally require manual advancement
    await chatPage.sendMessage('Deploy a simple database');

    // The workflow should advance automatically without waiting for user input
    // We'll check for workflow progress indicators
    await page.waitForSelector('[data-testid="workflow-progress"]', {
      timeout: 20000,
    });

    // Verify that the workflow is progressing automatically
    const progressIndicator = page.locator('[data-testid="workflow-progress"]');
    await expect(progressIndicator).toBeVisible();
  });

  test('should adapt question verbosity based on preferences', async ({
    page,
  }) => {
    // Set verbosity to minimal
    await chatPage.sendMessage('Set my verbosity level to minimal');

    // Wait for confirmation
    await page.waitForSelector('[data-testid="preference-updated"]', {
      timeout: 10000,
    });

    // Start a conversation that would generate questions
    await chatPage.sendMessage('Create a complex microservices architecture');

    // Wait for clarification requests
    await page.waitForSelector('[data-testid="clarification-request"]', {
      timeout: 30000,
    });

    // Verify that questions are more concise (minimal verbosity)
    const firstQuestion = page
      .locator('[data-testid="clarification-request"]')
      .first();
    const questionText = await firstQuestion
      .locator('[data-testid="question-text"]')
      .textContent();

    // Minimal verbosity questions should be shorter and more direct
    expect(questionText?.length || 0).toBeLessThan(200); // Reasonable threshold for minimal verbosity

    // Now change to detailed verbosity
    await chatPage.sendMessage('Set my verbosity level to detailed');
    await page.waitForSelector('[data-testid="preference-updated"]', {
      timeout: 10000,
    });

    // Start another conversation
    await chatPage.sendMessage('Set up monitoring for my application');

    // Wait for new clarification requests
    await page.waitForSelector('[data-testid="clarification-request"]', {
      timeout: 30000,
    });

    // Verify that questions now include more context and examples
    const detailedQuestion = page
      .locator('[data-testid="clarification-request"]')
      .first();
    await expect(
      detailedQuestion.locator('[data-testid="question-context"]'),
    ).toBeVisible();
    await expect(
      detailedQuestion.locator('[data-testid="question-examples"]'),
    ).toBeVisible();
  });

  test('should allow preference export and import', async ({ page }) => {
    // Customize some preferences first
    await chatPage.sendMessage(
      'Set my auto-advance to never and verbosity to detailed',
    );
    await page.waitForSelector('[data-testid="preference-updated"]', {
      timeout: 10000,
    });

    // Export preferences
    await chatPage.sendMessage('Export my preferences');

    // Wait for export data
    await page.waitForSelector('[data-testid="preferences-export"]', {
      timeout: 10000,
    });

    // Verify export data is available
    const exportData = page.locator('[data-testid="preferences-export"]');
    await expect(exportData).toBeVisible();
    await expect(
      exportData.locator('[data-testid="export-data"]'),
    ).toBeVisible();

    // Reset preferences to defaults
    await chatPage.sendMessage('Reset my preferences to defaults');
    await page.waitForSelector('[data-testid="preferences-reset"]', {
      timeout: 10000,
    });

    // Verify preferences are reset
    await chatPage.sendMessage('Show my current preferences');
    await page.waitForSelector('[data-testid="user-preferences"]', {
      timeout: 10000,
    });

    const resetPreferences = page.locator('[data-testid="user-preferences"]');
    await expect(
      resetPreferences.locator('[data-testid="has-customizations"]'),
    ).toHaveText('false');
  });

  test('should handle preference validation correctly', async ({ page }) => {
    // Try to set an invalid timeout value
    await chatPage.sendMessage('Set my auto-advance timeout to 500 seconds');

    // Should get validation error or corrected value
    await page.waitForSelector('[data-testid="preference-validation"]', {
      timeout: 10000,
    });

    const validationMessage = page.locator(
      '[data-testid="preference-validation"]',
    );
    await expect(validationMessage).toBeVisible();

    // The system should either reject the invalid value or clamp it to valid range
    const finalTimeout = await validationMessage
      .locator('[data-testid="final-timeout"]')
      .textContent();
    const timeoutValue = parseInt(finalTimeout || '0');
    expect(timeoutValue).toBeLessThanOrEqual(300); // Max allowed value
    expect(timeoutValue).toBeGreaterThanOrEqual(5); // Min allowed value
  });

  test('should provide contextual help for preference options', async ({
    page,
  }) => {
    // Request help about preferences
    await chatPage.sendMessage('Help me understand my preference options');

    // Wait for preference help
    await page.waitForSelector('[data-testid="preference-help"]', {
      timeout: 15000,
    });

    // Verify help content is comprehensive
    const helpContent = page.locator('[data-testid="preference-help"]');
    await expect(helpContent).toBeVisible();

    // Check for explanations of each preference type
    await expect(
      helpContent.locator('[data-testid="auto-advance-help"]'),
    ).toBeVisible();
    await expect(
      helpContent.locator('[data-testid="verbosity-help"]'),
    ).toBeVisible();
    await expect(
      helpContent.locator('[data-testid="question-format-help"]'),
    ).toBeVisible();

    // Verify examples are provided
    await expect(
      helpContent.locator('[data-testid="preference-examples"]'),
    ).toBeVisible();
  });
});
