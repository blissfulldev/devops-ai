import { z } from 'zod';
import { tool, type UIMessageStreamWriter } from 'ai';
import type { ChatMessage } from '@/lib/types';
import { UserPreferenceManager } from './user-preference-manager';

/**
 * Create AI tools for managing user preferences
 */
export function createUserPreferenceTools(
  chatId: string,
  dataStream: UIMessageStreamWriter<ChatMessage>,
) {
  return {
    getUserPreferences: tool({
      description: 'Get current user preferences for the HITL system',
      inputSchema: z.object({
        includeRecommendations: z
          .boolean()
          .default(false)
          .describe(
            'Whether to include AI-generated preference recommendations',
          ),
      }),
      execute: async ({ includeRecommendations }) => {
        try {
          const preferences = UserPreferenceManager.getUserPreferences(chatId);
          const hasCustomizations =
            UserPreferenceManager.hasCustomPreferences(chatId);

          let recommendations: any = undefined;
          if (includeRecommendations) {
            recommendations =
              UserPreferenceManager.getPreferenceRecommendations(chatId);
          }

          const result = {
            preferences,
            hasCustomizations,
            recommendations,
            defaults: UserPreferenceManager.getDefaultPreferences(),
          };

          // Stream preferences to UI
          dataStream.write({
            type: 'data-userPreferences',
            data: result,
            transient: false,
          });

          return result;
        } catch (error) {
          console.error('Failed to get user preferences:', error);
          return {
            preferences: UserPreferenceManager.getDefaultPreferences(),
            hasCustomizations: false,
            error: 'Failed to retrieve preferences',
          };
        }
      },
    }),

    updateUserPreferences: tool({
      description: 'Update user preferences for the HITL system',
      inputSchema: z.object({
        preferences: z.object({
          autoAdvancePreference: z
            .enum(['always', 'ask', 'never'])
            .optional()
            .describe('How to handle workflow auto-advancement'),
          verbosityLevel: z
            .enum(['minimal', 'normal', 'detailed'])
            .optional()
            .describe('Level of detail in questions and explanations'),
          skipOptionalSteps: z
            .boolean()
            .optional()
            .describe('Whether to automatically skip optional workflow steps'),
          preferredQuestionFormat: z
            .enum(['multiple_choice', 'open_ended', 'mixed'])
            .optional()
            .describe('Preferred format for clarification questions'),
          timeoutForAutoAdvance: z
            .number()
            .min(5)
            .max(300)
            .optional()
            .describe('Timeout in seconds before auto-advancing workflow'),
        }),
        reason: z
          .string()
          .optional()
          .describe('Reason for updating preferences (for logging)'),
      }),
      execute: async ({ preferences, reason }) => {
        try {
          const updatedPreferences = UserPreferenceManager.setUserPreferences(
            chatId,
            preferences,
          );

          const result = {
            success: true,
            updatedPreferences,
            changedKeys: Object.keys(preferences),
            reason: reason || 'User preference update',
          };

          // Stream updated preferences to UI
          dataStream.write({
            type: 'data-userPreferences',
            data: {
              preferences: updatedPreferences,
              hasCustomizations:
                UserPreferenceManager.hasCustomPreferences(chatId),
              updated: true,
              changedKeys: Object.keys(preferences),
            },
            transient: false,
          });

          return result;
        } catch (error) {
          console.error('Failed to update user preferences:', error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
    }),

    resetUserPreferences: tool({
      description: 'Reset user preferences to default values',
      inputSchema: z.object({
        confirm: z
          .boolean()
          .describe('Confirmation that user wants to reset preferences'),
      }),
      execute: async ({ confirm }) => {
        if (!confirm) {
          return {
            success: false,
            message: 'Reset cancelled - confirmation required',
          };
        }

        try {
          const defaultPreferences =
            UserPreferenceManager.resetPreferences(chatId);

          const result = {
            success: true,
            preferences: defaultPreferences,
            message: 'Preferences reset to defaults',
          };

          // Stream reset preferences to UI
          dataStream.write({
            type: 'data-userPreferences',
            data: {
              preferences: defaultPreferences,
              hasCustomizations: false,
              reset: true,
            },
            transient: false,
          });

          return result;
        } catch (error) {
          console.error('Failed to reset user preferences:', error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
    }),

    getPreferenceRecommendations: tool({
      description:
        'Get AI-generated recommendations for improving user preferences based on usage patterns',
      inputSchema: z.object({
        applyRecommendations: z
          .boolean()
          .default(false)
          .describe(
            'Whether to automatically apply high-confidence recommendations',
          ),
      }),
      execute: async ({ applyRecommendations }) => {
        try {
          const recommendations =
            UserPreferenceManager.getPreferenceRecommendations(chatId);

          const appliedRecommendations: any[] = [];

          if (
            applyRecommendations &&
            recommendations.recommendations.length > 0
          ) {
            // Apply high-confidence recommendations (confidence > 0.8)
            const highConfidenceRecs = recommendations.recommendations.filter(
              (rec) => rec.confidence > 0.8,
            );

            for (const rec of highConfidenceRecs) {
              try {
                UserPreferenceManager.setPreference(
                  chatId,
                  rec.preference,
                  rec.recommendedValue,
                );
                appliedRecommendations.push(rec);
              } catch (error) {
                console.warn(
                  `Failed to apply recommendation for ${rec.preference}:`,
                  error,
                );
              }
            }
          }

          const result = {
            recommendations: recommendations.recommendations,
            reasoning: recommendations.reasoning,
            appliedRecommendations,
            totalRecommendations: recommendations.recommendations.length,
            highConfidenceCount: recommendations.recommendations.filter(
              (r) => r.confidence > 0.8,
            ).length,
          };

          // Stream recommendations to UI
          dataStream.write({
            type: 'data-preferenceRecommendations',
            data: result,
            transient: false,
          });

          return result;
        } catch (error) {
          console.error('Failed to get preference recommendations:', error);
          return {
            recommendations: [],
            reasoning: 'Unable to generate recommendations',
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
    }),

    exportUserPreferences: tool({
      description: 'Export user preferences for backup or transfer',
      inputSchema: z.object({
        includeMetadata: z
          .boolean()
          .default(true)
          .describe('Whether to include metadata in the export'),
      }),
      execute: async ({ includeMetadata }) => {
        try {
          const exportData = UserPreferenceManager.exportPreferences(chatId);

          const result = {
            success: true,
            exportData: includeMetadata
              ? exportData
              : { preferences: exportData.preferences },
            exportedAt: new Date().toISOString(),
          };

          // Stream export data to UI
          dataStream.write({
            type: 'data-preferencesExport',
            data: result,
            transient: true,
          });

          return result;
        } catch (error) {
          console.error('Failed to export user preferences:', error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
    }),

    importUserPreferences: tool({
      description: 'Import user preferences from backup data',
      inputSchema: z.object({
        exportData: z.object({
          preferences: z.object({
            autoAdvancePreference: z.enum(['always', 'ask', 'never']),
            verbosityLevel: z.enum(['minimal', 'normal', 'detailed']),
            skipOptionalSteps: z.boolean(),
            preferredQuestionFormat: z.enum([
              'multiple_choice',
              'open_ended',
              'mixed',
            ]),
            timeoutForAutoAdvance: z.number().min(5).max(300),
          }),
          metadata: z.any().optional(),
        }),
        overwriteExisting: z
          .boolean()
          .default(true)
          .describe('Whether to overwrite existing preferences'),
      }),
      execute: async ({ exportData, overwriteExisting }) => {
        try {
          if (
            !overwriteExisting &&
            UserPreferenceManager.hasCustomPreferences(chatId)
          ) {
            return {
              success: false,
              message:
                'Import cancelled - existing preferences found and overwrite not allowed',
            };
          }

          const importedPreferences = UserPreferenceManager.importPreferences(
            chatId,
            exportData,
          );

          const result = {
            success: true,
            importedPreferences,
            message: 'Preferences imported successfully',
            importedAt: new Date().toISOString(),
          };

          // Stream imported preferences to UI
          dataStream.write({
            type: 'data-userPreferences',
            data: {
              preferences: importedPreferences,
              hasCustomizations: true,
              imported: true,
            },
            transient: false,
          });

          return result;
        } catch (error) {
          console.error('Failed to import user preferences:', error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
    }),
  };
}

/**
 * Helper function to check if user preferences allow auto-advancement
 */
export function shouldAutoAdvance(
  chatId: string,
  context?: {
    stepType?: 'required' | 'optional';
    confidence?: number;
    userPresent?: boolean;
  },
): boolean {
  try {
    const preferences = UserPreferenceManager.getUserPreferences(chatId);

    // Never auto-advance if user preference is 'never'
    if (preferences.autoAdvancePreference === 'never') {
      return false;
    }

    // Always auto-advance if user preference is 'always'
    if (preferences.autoAdvancePreference === 'always') {
      // But respect skipOptionalSteps setting
      if (context?.stepType === 'optional' && !preferences.skipOptionalSteps) {
        return false;
      }
      return true;
    }

    // For 'ask' preference, use context to make intelligent decisions
    if (preferences.autoAdvancePreference === 'ask') {
      // Don't auto-advance optional steps if user prefers not to skip them
      if (context?.stepType === 'optional' && !preferences.skipOptionalSteps) {
        return false;
      }

      // Auto-advance high-confidence required steps
      if (
        context?.stepType === 'required' &&
        (context?.confidence || 0) > 0.8
      ) {
        return true;
      }

      // Don't auto-advance if user is actively present (recently interacted)
      if (context?.userPresent) {
        return false;
      }
    }

    return false;
  } catch (error) {
    console.warn('Failed to check auto-advance preference:', error);
    return false; // Safe default
  }
}

/**
 * Helper function to get appropriate verbosity level for content
 */
export function getContentVerbosity(
  chatId: string,
  contentType: 'question' | 'explanation' | 'error' | 'guidance',
): 'minimal' | 'normal' | 'detailed' {
  try {
    const preferences = UserPreferenceManager.getUserPreferences(chatId);
    const baseLevel = preferences.verbosityLevel;

    // Adjust verbosity based on content type
    switch (contentType) {
      case 'error':
        // Errors should always be at least normal verbosity
        return baseLevel === 'minimal' ? 'normal' : baseLevel;

      case 'guidance':
        // Guidance can be reduced for experienced users
        return baseLevel;

      case 'question':
        // Questions follow user preference directly
        return baseLevel;

      case 'explanation':
        // Explanations can be more detailed if user prefers
        return baseLevel;

      default:
        return baseLevel;
    }
  } catch (error) {
    console.warn('Failed to get content verbosity preference:', error);
    return 'normal'; // Safe default
  }
}

/**
 * Helper function to get timeout for auto-advance operations
 */
export function getAutoAdvanceTimeout(chatId: string): number {
  try {
    const preferences = UserPreferenceManager.getUserPreferences(chatId);
    return preferences.timeoutForAutoAdvance * 1000; // Convert to milliseconds
  } catch (error) {
    console.warn('Failed to get auto-advance timeout preference:', error);
    return 30000; // 30 seconds default
  }
}
