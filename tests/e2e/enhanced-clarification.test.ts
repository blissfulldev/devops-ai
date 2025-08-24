import { test, expect } from '@playwright/test';
import { ChatPage } from '../pages/chat';

test.describe('Enhanced HITL Clarification System', () => {
  let chatPage: ChatPage;

  test.beforeEach(async ({ page }) => {
    chatPage = new ChatPage(page);
    await chatPage.goto();
  });

  test('should handle AI-powered question enrichment', async ({ page }) => {
    // Start a conversation that will trigger clarification requests
    await chatPage.sendMessage('Create a simple web application on AWS');

    // Wait for the agent to ask for clarifications
    await page.waitForSelector('[data-testid="clarification-request"]', {
      timeout: 30000,
    });

    // Check if the clarification request has enhanced features
    const clarificationRequest = page
      .locator('[data-testid="clarification-request"]')
      .first();

    // Verify enhanced context is present
    await expect(
      clarificationRequest.locator('[data-testid="question-context"]'),
    ).toBeVisible();

    // Verify examples are provided
    await expect(
      clarificationRequest.locator('[data-testid="question-examples"]'),
    ).toBeVisible();

    // Verify help text is available
    await expect(
      clarificationRequest.locator('[data-testid="contextual-help"]'),
    ).toBeVisible();
  });

  test('should validate answers with AI feedback', async ({ page }) => {
    // Start a conversation that will trigger clarification
    await chatPage.sendMessage('Deploy a database on AWS');

    // Wait for clarification request
    await page.waitForSelector('[data-testid="clarification-request"]', {
      timeout: 30000,
    });

    // Provide an incomplete answer
    const answerInput = page
      .locator('[data-testid="clarification-answer"]')
      .first();
    await answerInput.fill('db');

    // Submit the answer
    await page.locator('[data-testid="submit-clarification"]').first().click();

    // Check if validation feedback appears
    await page.waitForSelector('[data-testid="validation-feedback"]', {
      timeout: 10000,
    });

    // Verify validation feedback contains suggestions
    const feedback = page.locator('[data-testid="validation-feedback"]');
    await expect(
      feedback.locator('[data-testid="validation-suggestions"]'),
    ).toBeVisible();
  });

  test('should reuse previous answers when appropriate', async ({ page }) => {
    // First conversation - establish a question and answer
    await chatPage.sendMessage('Create an S3 bucket');

    // Wait for and answer clarification
    await page.waitForSelector('[data-testid="clarification-request"]', {
      timeout: 30000,
    });
    const firstAnswer = page
      .locator('[data-testid="clarification-answer"]')
      .first();
    await firstAnswer.fill('us-east-1');
    await page.locator('[data-testid="submit-clarification"]').first().click();

    // Wait for workflow to continue
    await page.waitForTimeout(2000);

    // Start a new conversation with similar question
    await chatPage.sendMessage('Set up another S3 bucket in the same region');

    // Check if answer reuse notification appears
    await page.waitForSelector('[data-testid="answer-reuse-notification"]', {
      timeout: 15000,
    });

    // Verify the reused answer is displayed
    const reuseNotification = page.locator(
      '[data-testid="answer-reuse-notification"]',
    );
    await expect(reuseNotification).toContainText('us-east-1');
    await expect(reuseNotification).toContainText('confidence');
  });

  test('should provide workflow guidance during clarifications', async ({
    page,
  }) => {
    // Start a complex workflow
    await chatPage.sendMessage(
      'Build a complete web application with database and CDN',
    );

    // Wait for clarification requests
    await page.waitForSelector('[data-testid="clarification-request"]', {
      timeout: 30000,
    });

    // Check if workflow guidance is present
    await expect(
      page.locator('[data-testid="workflow-guidance"]'),
    ).toBeVisible();

    // Verify progress indicator
    await expect(
      page.locator('[data-testid="workflow-progress"]'),
    ).toBeVisible();

    // Verify next steps information
    await expect(page.locator('[data-testid="next-steps"]')).toBeVisible();
  });

  test('should handle multiple clarifications efficiently', async ({
    page,
  }) => {
    // Start a conversation that requires multiple clarifications
    await chatPage.sendMessage('Create a microservices architecture on AWS');

    // Wait for multiple clarification requests
    await page.waitForSelector('[data-testid="clarification-request"]', {
      timeout: 30000,
    });

    // Count the number of clarification requests
    const clarificationRequests = page.locator(
      '[data-testid="clarification-request"]',
    );
    const count = await clarificationRequests.count();

    // Verify we have multiple requests (should be batched)
    expect(count).toBeGreaterThan(1);
    expect(count).toBeLessThanOrEqual(5); // Should respect the max limit

    // Verify each request has enhanced features
    for (let i = 0; i < count; i++) {
      const request = clarificationRequests.nth(i);
      await expect(
        request.locator('[data-testid="question-context"]'),
      ).toBeVisible();
    }
  });

  test('should provide follow-up questions for inadequate answers', async ({
    page,
  }) => {
    // Start a conversation
    await chatPage.sendMessage('Set up monitoring for my application');

    // Wait for clarification
    await page.waitForSelector('[data-testid="clarification-request"]', {
      timeout: 30000,
    });

    // Provide a vague answer
    const answerInput = page
      .locator('[data-testid="clarification-answer"]')
      .first();
    await answerInput.fill('yes');

    // Submit the answer
    await page.locator('[data-testid="submit-clarification"]').first().click();

    // Wait for validation and follow-up
    await page.waitForSelector('[data-testid="follow-up-questions"]', {
      timeout: 15000,
    });

    // Verify follow-up questions are provided
    const followUpQuestions = page.locator(
      '[data-testid="follow-up-questions"] [data-testid="follow-up-question"]',
    );
    const followUpCount = await followUpQuestions.count();
    expect(followUpCount).toBeGreaterThan(0);
    expect(followUpCount).toBeLessThanOrEqual(4); // Should be reasonable number
  });

  test('should maintain conversation context across clarifications', async ({
    page,
  }) => {
    // Start a conversation
    await chatPage.sendMessage('Deploy a web application with auto-scaling');

    // Answer first clarification
    await page.waitForSelector('[data-testid="clarification-request"]', {
      timeout: 30000,
    });
    let answerInput = page
      .locator('[data-testid="clarification-answer"]')
      .first();
    await answerInput.fill('Node.js application');
    await page.locator('[data-testid="submit-clarification"]').first().click();

    // Wait for potential next clarification
    await page.waitForTimeout(3000);

    // If there's another clarification, it should reference the previous answer
    const subsequentClarifications = page.locator(
      '[data-testid="clarification-request"]',
    );
    const subsequentCount = await subsequentClarifications.count();

    if (subsequentCount > 0) {
      const contextText = await subsequentClarifications
        .first()
        .locator('[data-testid="question-context"]')
        .textContent();
      expect(contextText).toContain('Node.js'); // Should reference previous answer
    }
  });
});
