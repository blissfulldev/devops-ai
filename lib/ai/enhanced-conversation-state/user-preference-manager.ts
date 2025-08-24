import type { UserPreferences } from './types';
import { EnhancedStateManager } from './enhanced-state-manager';

/**
 * Default user preferences for new users
 */
const DEFAULT_USER_PREFERENCES: UserPreferences = {
  autoAdvancePreference: 'ask',
  verbosityLevel: 'normal',
  skipOptionalSteps: false,
  preferredQuestionFormat: 'mixed',
  timeoutForAutoAdvance: 30, // 30 seconds
};

/**
 * Validation rules for user preferences
 */
const PREFERENCE_VALIDATION = {
  autoAdvancePreference: ['always', 'ask', 'never'],
  verbosityLevel: ['minimal', 'normal', 'detailed'],
  preferredQuestionFormat: ['multiple_choice', 'open_ended', 'mixed'],
  timeoutForAutoAdvance: { min: 5, max: 300 }, // 5 seconds to 5 minutes
} as const;

/**
 * UserPreferenceManager handles storage, retrieval, and validation of user preferences
 * for the enhanced HITL system.
 */
export class UserPreferenceManager {
  /**
   * Get user preferences for a chat session
   */
  static getUserPreferences(chatId: string): UserPreferences {
    try {
      const state = EnhancedStateManager.getEnhancedState(chatId);

      // If preferences exist, validate and return them
      if (state.userPreferences) {
        return UserPreferenceManager.validateAndSanitizePreferences(
          state.userPreferences,
        );
      }

      // Return default preferences for new users
      return { ...DEFAULT_USER_PREFERENCES };
    } catch (error) {
      console.warn(`Failed to get user preferences for chat ${chatId}:`, error);
      return { ...DEFAULT_USER_PREFERENCES };
    }
  }

  /**
   * Update user preferences for a chat session
   */
  static setUserPreferences(
    chatId: string,
    preferences: Partial<UserPreferences>,
  ): UserPreferences {
    try {
      // Get current preferences
      const currentPreferences =
        UserPreferenceManager.getUserPreferences(chatId);

      // Merge with new preferences
      const updatedPreferences = {
        ...currentPreferences,
        ...preferences,
      };

      // Validate the updated preferences
      const validatedPreferences =
        UserPreferenceManager.validateAndSanitizePreferences(
          updatedPreferences,
        );

      // Update the state
      EnhancedStateManager.updateEnhancedState(
        chatId,
        (state) => {
          state.userPreferences = validatedPreferences;
        },
        `Updated user preferences: ${Object.keys(preferences).join(', ')}`,
      );

      return validatedPreferences;
    } catch (error) {
      console.error(
        `Failed to set user preferences for chat ${chatId}:`,
        error,
      );
      throw new Error(
        `Failed to update user preferences: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Update a single preference value
   */
  static setPreference<K extends keyof UserPreferences>(
    chatId: string,
    key: K,
    value: UserPreferences[K],
  ): UserPreferences {
    const partialPreferences = { [key]: value } as Partial<UserPreferences>;
    return UserPreferenceManager.setUserPreferences(chatId, partialPreferences);
  }

  /**
   * Get a single preference value
   */
  static getPreference<K extends keyof UserPreferences>(
    chatId: string,
    key: K,
  ): UserPreferences[K] {
    const preferences = UserPreferenceManager.getUserPreferences(chatId);
    return preferences[key];
  }

  /**
   * Reset preferences to defaults
   */
  static resetPreferences(chatId: string): UserPreferences {
    const defaultPreferences = { ...DEFAULT_USER_PREFERENCES };

    EnhancedStateManager.updateEnhancedState(
      chatId,
      (state) => {
        state.userPreferences = defaultPreferences;
      },
      'Reset user preferences to defaults',
    );

    return defaultPreferences;
  }

  /**
   * Check if user has customized preferences (different from defaults)
   */
  static hasCustomPreferences(chatId: string): boolean {
    const preferences = UserPreferenceManager.getUserPreferences(chatId);
    const defaults = DEFAULT_USER_PREFERENCES;

    return Object.keys(preferences).some(
      (key) =>
        preferences[key as keyof UserPreferences] !==
        defaults[key as keyof UserPreferences],
    );
  }

  /**
   * Get preference recommendations based on user behavior
   */
  static getPreferenceRecommendations(chatId: string): {
    recommendations: Array<{
      preference: keyof UserPreferences;
      currentValue: any;
      recommendedValue: any;
      reason: string;
      confidence: number;
    }>;
    reasoning: string;
  } {
    try {
      const state = EnhancedStateManager.getEnhancedState(chatId);
      const preferences = UserPreferenceManager.getUserPreferences(chatId);
      const recommendations: Array<{
        preference: keyof UserPreferences;
        currentValue: any;
        recommendedValue: any;
        reason: string;
        confidence: number;
      }> = [];

      // Analyze user behavior patterns
      const metrics = state.performanceMetrics;
      const questionHistory = Array.from(state.questionHistory.values());
      const stateTransitions = state.stateTransitionLog;

      // Recommendation 1: Auto-advance preference based on response patterns
      if (stateTransitions.length > 5) {
        const manualAdvances = stateTransitions.filter(
          (t) =>
            t.type === 'manual_advance' || t.reason.includes('user requested'),
        ).length;
        const totalTransitions = stateTransitions.length;
        const manualAdvanceRate = manualAdvances / totalTransitions;

        if (
          manualAdvanceRate > 0.7 &&
          preferences.autoAdvancePreference !== 'always'
        ) {
          recommendations.push({
            preference: 'autoAdvancePreference',
            currentValue: preferences.autoAdvancePreference,
            recommendedValue: 'always',
            reason:
              'You frequently advance the workflow manually. Auto-advance could save time.',
            confidence: Math.min(manualAdvanceRate, 0.9),
          });
        } else if (
          manualAdvanceRate < 0.3 &&
          preferences.autoAdvancePreference === 'always'
        ) {
          recommendations.push({
            preference: 'autoAdvancePreference',
            currentValue: preferences.autoAdvancePreference,
            recommendedValue: 'ask',
            reason:
              'You seem to prefer more control over workflow progression.',
            confidence: Math.min(1 - manualAdvanceRate, 0.8),
          });
        }
      }

      // Recommendation 2: Verbosity level based on question complexity
      if (questionHistory.length > 3) {
        const avgAnswerLength =
          questionHistory
            .filter((q) => q.answer)
            .reduce((sum, q) => sum + (q.answer?.answer.length || 0), 0) /
          questionHistory.filter((q) => q.answer).length;

        if (avgAnswerLength > 100 && preferences.verbosityLevel === 'minimal') {
          recommendations.push({
            preference: 'verbosityLevel',
            currentValue: preferences.verbosityLevel,
            recommendedValue: 'normal',
            reason:
              'Your detailed answers suggest you might benefit from more context in questions.',
            confidence: 0.7,
          });
        } else if (
          avgAnswerLength < 20 &&
          preferences.verbosityLevel === 'detailed'
        ) {
          recommendations.push({
            preference: 'verbosityLevel',
            currentValue: preferences.verbosityLevel,
            recommendedValue: 'normal',
            reason:
              'Your concise answers suggest you might prefer less verbose questions.',
            confidence: 0.6,
          });
        }
      }

      // Recommendation 3: Question format based on response patterns
      if (questionHistory.length > 5) {
        const multipleChoiceQuestions = questionHistory.filter(
          (q) => q.answer?.selectedOption,
        ).length;
        const openEndedQuestions =
          questionHistory.length - multipleChoiceQuestions;

        if (
          multipleChoiceQuestions > openEndedQuestions * 2 &&
          preferences.preferredQuestionFormat !== 'multiple_choice'
        ) {
          recommendations.push({
            preference: 'preferredQuestionFormat',
            currentValue: preferences.preferredQuestionFormat,
            recommendedValue: 'multiple_choice',
            reason:
              'You seem to prefer selecting from options rather than typing answers.',
            confidence: 0.8,
          });
        }
      }

      // Recommendation 4: Timeout adjustment based on response times
      if (metrics.averageResponseTime > 0) {
        const avgResponseTimeSeconds = metrics.averageResponseTime / 1000;

        if (avgResponseTimeSeconds > preferences.timeoutForAutoAdvance * 1.5) {
          const recommendedTimeout = Math.min(
            Math.ceil(avgResponseTimeSeconds * 1.2),
            300,
          );
          recommendations.push({
            preference: 'timeoutForAutoAdvance',
            currentValue: preferences.timeoutForAutoAdvance,
            recommendedValue: recommendedTimeout,
            reason: `Your average response time (${Math.round(avgResponseTimeSeconds)}s) suggests a longer timeout might be better.`,
            confidence: 0.7,
          });
        }
      }

      return {
        recommendations,
        reasoning:
          recommendations.length > 0
            ? `Based on your usage patterns, we found ${recommendations.length} preference(s) that could improve your experience.`
            : 'Your current preferences seem well-suited to your usage patterns.',
      };
    } catch (error) {
      console.warn(
        `Failed to generate preference recommendations for chat ${chatId}:`,
        error,
      );
      return {
        recommendations: [],
        reasoning: 'Unable to analyze usage patterns for recommendations.',
      };
    }
  }

  /**
   * Export preferences for backup or transfer
   */
  static exportPreferences(chatId: string): {
    preferences: UserPreferences;
    metadata: {
      chatId: string;
      exportedAt: string;
      hasCustomizations: boolean;
    };
  } {
    const preferences = UserPreferenceManager.getUserPreferences(chatId);

    return {
      preferences,
      metadata: {
        chatId,
        exportedAt: new Date().toISOString(),
        hasCustomizations: UserPreferenceManager.hasCustomPreferences(chatId),
      },
    };
  }

  /**
   * Import preferences from backup
   */
  static importPreferences(
    chatId: string,
    exportedData: {
      preferences: UserPreferences;
      metadata?: any;
    },
  ): UserPreferences {
    try {
      const validatedPreferences =
        UserPreferenceManager.validateAndSanitizePreferences(
          exportedData.preferences,
        );

      EnhancedStateManager.updateEnhancedState(
        chatId,
        (state) => {
          state.userPreferences = validatedPreferences;
        },
        'Imported user preferences from backup',
      );

      return validatedPreferences;
    } catch (error) {
      console.error(`Failed to import preferences for chat ${chatId}:`, error);
      throw new Error(
        `Failed to import preferences: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Validate and sanitize user preferences
   */
  private static validateAndSanitizePreferences(
    preferences: Partial<UserPreferences>,
  ): UserPreferences {
    const sanitized = { ...DEFAULT_USER_PREFERENCES };

    // Validate autoAdvancePreference
    if (
      preferences.autoAdvancePreference &&
      PREFERENCE_VALIDATION.autoAdvancePreference.includes(
        preferences.autoAdvancePreference,
      )
    ) {
      sanitized.autoAdvancePreference = preferences.autoAdvancePreference;
    }

    // Validate verbosityLevel
    if (
      preferences.verbosityLevel &&
      PREFERENCE_VALIDATION.verbosityLevel.includes(preferences.verbosityLevel)
    ) {
      sanitized.verbosityLevel = preferences.verbosityLevel;
    }

    // Validate skipOptionalSteps
    if (typeof preferences.skipOptionalSteps === 'boolean') {
      sanitized.skipOptionalSteps = preferences.skipOptionalSteps;
    }

    // Validate preferredQuestionFormat
    if (
      preferences.preferredQuestionFormat &&
      PREFERENCE_VALIDATION.preferredQuestionFormat.includes(
        preferences.preferredQuestionFormat,
      )
    ) {
      sanitized.preferredQuestionFormat = preferences.preferredQuestionFormat;
    }

    // Validate timeoutForAutoAdvance
    if (typeof preferences.timeoutForAutoAdvance === 'number') {
      const timeout = Math.max(
        PREFERENCE_VALIDATION.timeoutForAutoAdvance.min,
        Math.min(
          PREFERENCE_VALIDATION.timeoutForAutoAdvance.max,
          preferences.timeoutForAutoAdvance,
        ),
      );
      sanitized.timeoutForAutoAdvance = timeout;
    }

    return sanitized;
  }

  /**
   * Get default preferences (useful for UI)
   */
  static getDefaultPreferences(): UserPreferences {
    return { ...DEFAULT_USER_PREFERENCES };
  }

  /**
   * Get preference validation rules (useful for UI validation)
   */
  static getValidationRules() {
    return PREFERENCE_VALIDATION;
  }

  /**
   * Get a summary of user preferences
   */
  static getPreferenceSummary(chatId: string): {
    preferences: UserPreferences;
    isCustomized: boolean;
    summary: string;
  } {
    const preferences = UserPreferenceManager.getUserPreferences(chatId);
    const isCustomized = UserPreferenceManager.hasCustomPreferences(chatId);

    const customizations = [];
    if (
      preferences.autoAdvancePreference !==
      DEFAULT_USER_PREFERENCES.autoAdvancePreference
    ) {
      customizations.push(`auto-advance: ${preferences.autoAdvancePreference}`);
    }
    if (
      preferences.verbosityLevel !== DEFAULT_USER_PREFERENCES.verbosityLevel
    ) {
      customizations.push(`verbosity: ${preferences.verbosityLevel}`);
    }
    if (
      preferences.skipOptionalSteps !==
      DEFAULT_USER_PREFERENCES.skipOptionalSteps
    ) {
      customizations.push(`skip optional: ${preferences.skipOptionalSteps}`);
    }
    if (
      preferences.preferredQuestionFormat !==
      DEFAULT_USER_PREFERENCES.preferredQuestionFormat
    ) {
      customizations.push(
        `question format: ${preferences.preferredQuestionFormat}`,
      );
    }
    if (
      preferences.timeoutForAutoAdvance !==
      DEFAULT_USER_PREFERENCES.timeoutForAutoAdvance
    ) {
      customizations.push(`timeout: ${preferences.timeoutForAutoAdvance}s`);
    }

    const summary = isCustomized
      ? `Customized preferences: ${customizations.join(', ')}`
      : 'Using default preferences';

    return {
      preferences,
      isCustomized,
      summary,
    };
  }
}

// Export individual functions for convenience
export const {
  getUserPreferences,
  setUserPreferences,
  setPreference,
  getPreference,
  resetPreferences,
  hasCustomPreferences,
  getPreferenceRecommendations,
  exportPreferences,
  importPreferences,
  getDefaultPreferences,
  getValidationRules,
  getPreferenceSummary,
} = UserPreferenceManager;
