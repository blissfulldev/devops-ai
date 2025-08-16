'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MessageCircleQuestion, Clock, AlertCircle } from 'lucide-react';
import { ClarificationDialog } from './clarification-dialog';
import type { ClarificationRequest, ClarificationResponse } from '@/lib/types';
import { useDataStream } from './data-stream-provider';

interface ClarificationManagerProps {
  chatId: string;
  onClarificationResponse: (response: ClarificationResponse) => void;
}

export function ClarificationManager({
  chatId,
  onClarificationResponse,
}: ClarificationManagerProps) {
  const [pendingRequests, setPendingRequests] = useState<ClarificationRequest[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<ClarificationRequest | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { dataStream } = useDataStream();

  // Listen for clarification requests from the data stream
  useEffect(() => {
    const clarificationRequests = dataStream
      .filter(part => part.type === 'data-clarificationRequest')
      .map(part => part.data as ClarificationRequest);

    if (clarificationRequests.length > 0) {
      setPendingRequests(prev => {
        const newRequests = clarificationRequests.filter(
          req => !prev.some(existing => existing.id === req.id)
        );
        return [...prev, ...newRequests];
      });
    }
  }, [dataStream]);

  const handleRequestClick = (request: ClarificationRequest) => {
    setSelectedRequest(request);
    setIsDialogOpen(true);
  };

  const handleClarificationSubmit = (response: ClarificationResponse) => {
    // Remove the request from pending list
    setPendingRequests(prev => 
      prev.filter(req => req.id !== response.requestId)
    );
    
    // Notify parent component
    onClarificationResponse(response);
    
    setSelectedRequest(null);
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

  if (pendingRequests.length === 0) {
    return null;
  }

  return (
    <>
      <div className="space-y-3 mb-4">
        <div className="flex items-center gap-2 text-amber-600">
          <AlertCircle className="size-5" />
          <span className="font-medium">
            {pendingRequests.length} clarification{pendingRequests.length > 1 ? 's' : ''} needed
          </span>
        </div>
        
        {pendingRequests.map((request) => (
          <Card key={request.id} className="border-l-4 border-l-amber-400">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageCircleQuestion className="size-4 text-blue-600" />
                  <CardTitle className="text-sm font-medium">
                    Clarification from {request.agentName}
                  </CardTitle>
                  <Badge className={getPriorityColor(request.priority)}>
                    {request.priority}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="size-3" />
                  <span>{new Date(request.timestamp).toLocaleTimeString()}</span>
                </div>
              </div>
              <CardDescription className="text-sm">
                {request.question}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex justify-between items-center">
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {request.context}
                </p>
                <Button 
                  size="sm" 
                  onClick={() => handleRequestClick(request)}
                  className="ml-2"
                >
                  Respond
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {selectedRequest && (
        <ClarificationDialog
          request={selectedRequest}
          isOpen={isDialogOpen}
          onClose={() => {
            setIsDialogOpen(false);
            setSelectedRequest(null);
          }}
          onSubmit={handleClarificationSubmit}
        />
      )}
    </>
  );
}