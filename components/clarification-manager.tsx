'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { User } from 'lucide-react';
import type { ClarificationRequest, ClarificationResponse } from '@/lib/types';
import { useDataStream } from './data-stream-provider';

interface MultipleClarificationDialogProps {
  requests: ClarificationRequest[];
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (responses: ClarificationResponse[]) => void;
}

function MultipleClarificationDialog({
  requests,
  isOpen,
  onClose,
  onSubmit,
}: MultipleClarificationDialogProps) {
  const [responses, setResponses] = useState<Record<string, string>>({});

  useEffect(() => {
    // Initialize responses for all requests
    const initialResponses: Record<string, string> = {};
    requests.forEach((request) => {
      initialResponses[request.id] = '';
    });
    setResponses(initialResponses);
  }, [requests]);

  const handleResponseChange = (requestId: string, value: string) => {
    setResponses((prev) => ({ ...prev, [requestId]: value }));
  };

  const handleSubmit = () => {
    // Convert responses to ClarificationResponse format
    const clarificationResponses: ClarificationResponse[] = Object.entries(
      responses,
    )
      .filter(([, value]) => value.trim())
      .map(([requestId, response]) => {
        const request = requests.find((r) => r.id === requestId);
        return {
          id: `response-${requestId}-${Date.now()}`,
          requestId,
          answer: response.trim(),
          selectedOption: request?.options?.includes(response.trim())
            ? response.trim()
            : undefined,
          timestamp: new Date().toISOString(),
        };
      });

    onSubmit(clarificationResponses);
    onClose();
  };

  const canSubmit = Object.values(responses).some((response) =>
    response.trim(),
  );

  const answeredCount = Object.values(responses).filter((response) =>
    response.trim(),
  ).length;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Clarification Required</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {requests.map((request, index) => (
            <div key={request.id} className="border rounded-lg p-4">
              <div className="flex items-start gap-3 mb-3">
                <User className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="flex-1">
                  <div className="font-medium text-sm">
                    Question {index + 1}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {request.question}
                  </p>
                </div>
              </div>

              {request.options && request.options.length > 0 ? (
                <RadioGroup
                  value={responses[request.id] || ''}
                  onValueChange={(value) =>
                    handleResponseChange(request.id, value)
                  }
                >
                  {request.options.map((option, optIndex) => (
                    <div
                      key={`${request.id}-option-${optIndex}`}
                      className="flex items-center space-x-2"
                    >
                      <RadioGroupItem
                        value={option}
                        id={`${request.id}-${optIndex}`}
                      />
                      <Label htmlFor={`${request.id}-${optIndex}`}>
                        {option}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              ) : (
                <Textarea
                  placeholder="Type your response..."
                  value={responses[request.id] || ''}
                  onChange={(e) =>
                    handleResponseChange(request.id, e.target.value)
                  }
                  className="min-h-[80px]"
                />
              )}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            Submit {answeredCount > 0 ? `${answeredCount} ` : ''}Response
            {answeredCount === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ClarificationManagerProps {
  chatId: string;
  onClarificationResponse: (response: ClarificationResponse) => void;
  onBatchClarificationResponse?: (responses: ClarificationResponse[]) => void;
}

export function ClarificationManager({
  chatId,
  onClarificationResponse,
  onBatchClarificationResponse,
}: ClarificationManagerProps) {
  const [pendingRequests, setPendingRequests] = useState<
    ClarificationRequest[]
  >([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [answeredRequestIds, setAnsweredRequestIds] = useState<Set<string>>(
    new Set(),
  );
  const { dataStream } = useDataStream();

  // Listen for clarification requests from the data stream
  useEffect(() => {
    const clarificationRequests = dataStream
      .filter((part) => part.type === 'data-clarificationRequest')
      .map((part) => part.data as ClarificationRequest)
      .filter((req) => !answeredRequestIds.has(req.id)); // Filter out already answered requests

    console.log(
      'Data stream clarification requests (after filtering):',
      clarificationRequests,
    );
    console.log('Answered request IDs:', Array.from(answeredRequestIds));

    if (clarificationRequests.length > 0) {
      setPendingRequests((prev) => {
        console.log('Previous pending requests:', prev);
        const newRequests = clarificationRequests.filter(
          (req) => !prev.some((existing) => existing.id === req.id),
        );
        console.log('New requests to add:', newRequests);
        const updatedRequests = [...prev, ...newRequests];
        console.log('Updated pending requests:', updatedRequests);

        // Auto-open dialog when new requests arrive
        if (newRequests.length > 0 && !isDialogOpen) {
          console.log('Auto-opening dialog for new requests');
          setIsDialogOpen(true);
        }

        return updatedRequests;
      });
    }
  }, [dataStream, isDialogOpen, answeredRequestIds]);

  const handleClarificationSubmit = (responses: ClarificationResponse[]) => {
    console.log('handleClarificationSubmit called with responses:', responses);
    console.log('Current pendingRequests before removal:', pendingRequests);

    // Close dialog first
    setIsDialogOpen(false);

    // Track answered request IDs to prevent them from being re-added
    const answeredIds = responses.map((res) => res.requestId);
    setAnsweredRequestIds((prev) => new Set([...prev, ...answeredIds]));
    console.log('Added answered request IDs:', answeredIds);

    // Remove the answered requests from pending list
    setPendingRequests((prev) => {
      const filteredRequests = prev.filter(
        (req) => !responses.some((res) => res.requestId === req.id),
      );
      console.log('Pending requests after filtering:', filteredRequests);
      return filteredRequests;
    });

    // Use batch handler if available, otherwise fall back to individual calls
    if (onBatchClarificationResponse && responses.length > 1) {
      onBatchClarificationResponse(responses);
    } else {
      // Notify parent component for each response (backward compatibility)
      responses.forEach((response) => {
        onClarificationResponse(response);
      });
    }
  };

  if (pendingRequests.length === 0) {
    return null;
  }

  return (
    <MultipleClarificationDialog
      requests={pendingRequests}
      isOpen={isDialogOpen}
      onClose={() => setIsDialogOpen(false)}
      onSubmit={handleClarificationSubmit}
    />
  );
}