'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Clock, User, MessageCircleQuestion } from 'lucide-react';
import type { ClarificationRequest, ClarificationResponse } from '@/lib/types';
import { generateUUID } from '@/lib/utils';

interface ClarificationDialogProps {
  request: ClarificationRequest;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (response: ClarificationResponse) => void;
}

export function ClarificationDialog({
  request,
  isOpen,
  onClose,
  onSubmit,
}: ClarificationDialogProps) {
  const [answer, setAnswer] = useState('');
  const [selectedOption, setSelectedOption] = useState<string>('');

  const handleSubmit = () => {
    if (!answer.trim() && !selectedOption) return;

    const response: ClarificationResponse = {
      id: generateUUID(),
      requestId: request.id,
      answer: answer.trim() || selectedOption,
      selectedOption: selectedOption || undefined,
      timestamp: new Date().toISOString(),
    };

    onSubmit(response);
    setAnswer('');
    setSelectedOption('');
    onClose();
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low':
        return 'bg-green-100 text-green-800 border-green-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <MessageCircleQuestion className="size-5 text-blue-600" />
            <DialogTitle>Agent Clarification Request</DialogTitle>
            <Badge className={getPriorityColor(request.priority)}>
              {request.priority} priority
            </Badge>
          </div>
          <DialogDescription className="text-left">
            <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
              <div className="flex items-center gap-1">
                <User className="size-4" />
                <span className="font-medium">{request.agentName}</span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="size-4" />
                <span>{new Date(request.timestamp).toLocaleTimeString()}</span>
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Context */}
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
            <h4 className="font-medium text-blue-900 mb-2">Context</h4>
            <p className="text-blue-800 text-sm">{request.context}</p>
          </div>

          {/* Question */}
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
            <h4 className="font-medium text-gray-900 mb-2">Question</h4>
            <p className="text-gray-800">{request.question}</p>
          </div>

          {/* Options (if provided) */}
          {request.options && request.options.length > 0 && (
            <div className="space-y-3">
              <h4 className="font-medium text-gray-900">Select an option:</h4>
              <RadioGroup value={selectedOption} onValueChange={setSelectedOption}>
                {request.options.map((option, index) => (
                  <div key={option} className="flex items-center space-x-2">
                    <RadioGroupItem value={option} id={`option-${index}`} />
                    <Label htmlFor={`option-${index}`} className="flex-1 cursor-pointer">
                      {option}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          )}

          {/* Custom Answer */}
          <div className="space-y-2">
            <Label htmlFor="custom-answer">
              {request.options && request.options.length > 0 
                ? 'Or provide a custom answer:' 
                : 'Your answer:'}
            </Label>
            <Textarea
              id="custom-answer"
              placeholder="Type your response here..."
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={!answer.trim() && !selectedOption}
          >
            Submit Response
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}