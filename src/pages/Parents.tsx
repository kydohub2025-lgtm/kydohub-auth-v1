import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Search } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

const Parents = () => {
  const parents = [
    { id: 1, name: 'Jennifer Johnson', email: 'j.johnson@email.com', children: 'Emma Johnson', status: 'Active' },
    { id: 2, name: 'Robert Smith', email: 'r.smith@email.com', children: 'Liam Smith', status: 'Active' },
    { id: 3, name: 'Maria Brown', email: 'm.brown@email.com', children: 'Olivia Brown', status: 'Active' },
    { id: 4, name: 'James Davis', email: 'j.davis@email.com', children: 'Noah Davis', status: 'Active' },
    { id: 5, name: 'Lisa Wilson', email: 'l.wilson@email.com', children: 'Ava Wilson', status: 'Active' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Parents</h1>
          <p className="text-muted-foreground mt-1">Manage parent and guardian accounts</p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Add Parent
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Parent Directory</CardTitle>
          <CardDescription>View and manage all parent accounts</CardDescription>
          <div className="pt-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search parents..." className="pl-10" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Children</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {parents.map((parent) => (
                <TableRow key={parent.id}>
                  <TableCell className="font-medium">{parent.name}</TableCell>
                  <TableCell>{parent.email}</TableCell>
                  <TableCell>{parent.children}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{parent.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm">View</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default Parents;
